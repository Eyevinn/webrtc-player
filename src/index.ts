import { Adapter } from './adapters/Adapter';
import {
  AdapterFactory,
  AdapterFactoryFunction
} from './adapters/AdapterFactory';
import { EventEmitter } from 'events';
import { CSAIManager } from '@eyevinn/csai-manager';

export { ListAvailableAdapters } from './adapters/AdapterFactory';

enum Message {
  NO_MEDIA = 'no-media',
  MEDIA_RECOVERED = 'media-recovered',
  PEER_CONNECTION_FAILED = 'peer-connection-failed',
  PEER_CONNECTION_CONNECTED = 'peer-connection-connected',
  INITIAL_CONNECTION_FAILED = 'initial-connection-failed',
  RECONNECTION_FAILED = 'reconnection-failed',
  CONNECT_ERROR = 'connect-error',
  PLAYER_MUTED = 'player-muted',
  PLAYER_UNMUTED = 'player-unmuted',
  VIDEO_RECOVERY_ATTEMPT = 'video-recovery-attempt',
  NETWORK_ONLINE_RECONNECT = 'network-online-reconnect'
}

export interface MediaConstraints {
  audioOnly?: boolean;
  videoOnly?: boolean;
}

const MediaConstraintsDefaults: MediaConstraints = {
  audioOnly: false,
  videoOnly: false
};

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  vmapUrl?: string;
  reconnectAttemptsLeft?: number;
  statsTypeFilter?: string; // regexp
  detectTimeout?: boolean;
  timeoutThreshold?: number;
  mediaConstraints?: MediaConstraints;
  rtcConfiguration?: RTCConfiguration;
  videoHealthMonitor?: boolean;
  videoHealthPollIntervalMs?: number;
  videoFreezeThresholdMs?: number;
  reconnectOnOnline?: boolean;
  iceGatheringTimeoutMs?: number;
}

const RECONNECT_ATTEMPTS = 5; // number of times to attempt reconnecting before giving up and emitting a reconnection failed event, can be configured with WebRTCPlayerOptions.reconnectAttemptsLeft
const MEDIA_TIMEOUT_THRESHOLD = 15000; //15 seconds without media is considered a timeout, can be configured with WebRTCPlayerOptions.timeoutThreshold
const VIDEO_HEALTH_POLL_INTERVAL = 1000; // how often to poll getStats() for video freeze detection, can be configured with WebRTCPlayerOptions.videoHealthPollIntervalMs
const VIDEO_FREEZE_THRESHOLD = 3000; // how long the decoder can be stalled while packets keep arriving before we force a decoder recovery, can be configured with WebRTCPlayerOptions.videoFreezeThresholdMs
const ICE_GATHERING_TIMEOUT = 2000; // how long to wait for ICE candidate gathering before sending the offer with whatever was gathered, can be configured with WebRTCPlayerOptions.iceGatheringTimeoutMs

export class WebRTCPlayer extends EventEmitter {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection = <RTCPeerConnection>{};
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction | undefined = undefined;
  private iceServers: RTCIceServer[];
  private debug: boolean;
  private channelUrl: URL = <URL>{};
  private authKey?: string = undefined;
  private configuredReconnectAttempts: number = RECONNECT_ATTEMPTS;
  private reconnectAttemptsLeft: number = RECONNECT_ATTEMPTS;
  private csaiManager?: CSAIManager;
  private adapter: Adapter = <Adapter>{};
  private statsInterval: ReturnType<typeof setInterval> | undefined;
  private statsTypeFilter: string | undefined = undefined;
  private msStatsInterval = 5000;
  private mediaTimeoutOccured = false;
  private mediaTimeoutThreshold = MEDIA_TIMEOUT_THRESHOLD;
  private timeoutThresholdCounter = 0;
  private bytesReceived = 0;
  private mediaConstraints: MediaConstraints;
  private rtcConfiguration?: RTCConfiguration;
  private videoHealthMonitorEnabled: boolean;
  private videoHealthPollIntervalMs = VIDEO_HEALTH_POLL_INTERVAL;
  private videoFreezeThresholdMs = VIDEO_FREEZE_THRESHOLD;
  private videoHealthInterval: ReturnType<typeof setInterval> | undefined;
  private lastFramesDecoded = 0;
  private lastVideoPacketsReceived = 0;
  private videoFreezeElapsedMs = 0;
  private reconnectOnOnline: boolean;
  private onlineListener: (() => void) | undefined;
  private iceGatheringTimeoutMs = ICE_GATHERING_TIMEOUT;

  constructor(opts: WebRTCPlayerOptions) {
    super();
    this.mediaConstraints = {
      ...MediaConstraintsDefaults,
      ...opts.mediaConstraints
    };
    this.videoElement = opts.video;
    this.configuredReconnectAttempts =
      opts.reconnectAttemptsLeft ?? RECONNECT_ATTEMPTS;
    this.reconnectAttemptsLeft = this.configuredReconnectAttempts;
    this.mediaTimeoutThreshold =
      opts.timeoutThreshold ?? MEDIA_TIMEOUT_THRESHOLD;
    this.adapterType = opts.type;
    this.adapterFactory = opts.adapterFactory;
    this.statsTypeFilter = opts.statsTypeFilter;
    this.mediaTimeoutThreshold =
      opts.timeoutThreshold ?? this.mediaTimeoutThreshold;

    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (opts.iceServers) {
      this.iceServers = opts.iceServers;
    }
    this.debug = !!opts.debug;
    this.rtcConfiguration = opts.rtcConfiguration;
    this.videoHealthMonitorEnabled = opts.videoHealthMonitor ?? false;
    this.videoHealthPollIntervalMs =
      opts.videoHealthPollIntervalMs ?? VIDEO_HEALTH_POLL_INTERVAL;
    this.videoFreezeThresholdMs =
      opts.videoFreezeThresholdMs ?? VIDEO_FREEZE_THRESHOLD;
    this.reconnectOnOnline = opts.reconnectOnOnline ?? true;
    if (this.reconnectOnOnline && typeof window !== 'undefined') {
      this.onlineListener = this.onNetworkOnline.bind(this);
      window.addEventListener('online', this.onlineListener);
    }
    this.iceGatheringTimeoutMs =
      opts.iceGatheringTimeoutMs ?? ICE_GATHERING_TIMEOUT;
    if (opts.vmapUrl) {
      this.csaiManager = new CSAIManager({
        contentVideoElement: this.videoElement,
        vmapUrl: opts.vmapUrl,
        isLive: true,
        autoplay: true
      });
      this.videoElement.addEventListener('ended', () => {
        if (this.csaiManager) {
          this.csaiManager.destroy();
        }
      });
    }
    this.videoElement.addEventListener('volumechange', () => {
      if (this.videoElement.muted) {
        this.emit(Message.PLAYER_MUTED);
      } else {
        this.emit(Message.PLAYER_UNMUTED);
      }
    });
  }

  async load(channelUrl: URL, authKey: string | undefined = undefined) {
    this.channelUrl = channelUrl;
    this.authKey = authKey;
    this.connect();
  }

  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  private log(...args: any[]) {
    if (this.debug) {
      console.log('WebRTC-player', ...args);
    }
  }

  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  private error(...args: any[]) {
    console.error('WebRTC-player', ...args);
  }

  private async onConnectionStateChange() {
    if (this.peer.connectionState === 'failed') {
      this.emit(Message.PEER_CONNECTION_FAILED);
      this.peer && this.peer.close();

      if (this.reconnectAttemptsLeft <= 0) {
        this.emit(Message.RECONNECTION_FAILED);
        this.error('Connection failed, reconnecting failed');
        return;
      }

      this.log(
        `Connection failed, recreating peer connection, attempts left ${this.reconnectAttemptsLeft}`
      );
      await this.connect();
      this.reconnectAttemptsLeft--;
    } else if (this.peer.connectionState === 'connected') {
      this.log('Connected');
      this.emit(Message.PEER_CONNECTION_CONNECTED);
      this.reconnectAttemptsLeft = this.configuredReconnectAttempts;
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
    }
  }

  private onNetworkOnline() {
    // The browser regained connectivity. Reconnect immediately rather than
    // waiting for the reactive connection-failed path, and do NOT spend a
    // reconnect attempt from the configured retry budget — a network return
    // is not a failed attempt.
    if (this.peer && this.peer.connectionState === 'connected') {
      return;
    }
    this.log('Network back online, triggering immediate reconnect');
    this.emit(Message.NETWORK_ONLINE_RECONNECT);
    // Defer to the next tick so the caller's own 'online' handlers can run and
    // so we never reconnect synchronously inside the event dispatch.
    setTimeout(() => {
      if (this.peer && this.peer.connectionState === 'connected') {
        return;
      }
      this.peer && this.peer.close();
      this.videoElement.srcObject = null;
      this.connect();
    }, 0);
  }

  private onErrorHandler(error: string) {
    this.log(`onError=${error}`);
    switch (error) {
      case 'reconnectneeded':
        this.peer && this.peer.close();
        this.videoElement.srcObject = null;
        this.setupPeer();
        this.adapter.resetPeer(this.peer);
        this.adapter.connect({ timeout: this.iceGatheringTimeoutMs });
        break;
      case 'connectionfailed':
        this.peer && this.peer.close();
        this.videoElement.srcObject = null;
        this.emit(Message.INITIAL_CONNECTION_FAILED);
        break;
      case 'connecterror':
        this.peer && this.peer.close();
        this.adapter.resetPeer(this.peer);
        this.emit(Message.CONNECT_ERROR);
        break;
    }
  }

  private async onConnectionStats() {
    if (this.peer && this.statsTypeFilter) {
      let bytesReceivedBlock = 0;
      const stats = await this.peer.getStats(null);

      stats.forEach((report) => {
        if (report.type.match(this.statsTypeFilter)) {
          this.emit(`stats:${report.type}`, report);
        }

        //inbound-rtp attribute bytesReceived from stats report will contain the total number of bytes received for this SSRC.
        //In this case there are several SSRCs. They are all added together in each onConnectionStats iteration and compared to their value during the previous iteration.
        if (report.type.match('inbound-rtp')) {
          bytesReceivedBlock += report.bytesReceived;
        }
      });

      if (bytesReceivedBlock <= this.bytesReceived) {
        this.timeoutThresholdCounter += this.msStatsInterval;

        if (
          this.mediaTimeoutOccured === false &&
          this.timeoutThresholdCounter >= this.mediaTimeoutThreshold
        ) {
          this.emit(Message.NO_MEDIA);
          this.mediaTimeoutOccured = true;
        }
      } else {
        this.bytesReceived = bytesReceivedBlock;
        this.timeoutThresholdCounter = 0;

        if (this.mediaTimeoutOccured == true) {
          this.emit(Message.MEDIA_RECOVERED);
          this.mediaTimeoutOccured = false;
        }
      }
    }
  }

  private setupPeer() {
    this.peer = new RTCPeerConnection({
      iceServers: this.iceServers,
      ...this.rtcConfiguration
    });
    this.peer.onconnectionstatechange = this.onConnectionStateChange.bind(this);
    this.peer.ontrack = this.onTrack.bind(this);
  }

  private onTrack(event: RTCTrackEvent) {
    for (const stream of event.streams) {
      if (stream.id === 'feedbackvideomslabel') {
        continue;
      }

      console.log(
        'Set video element remote stream to ' + stream.id,
        ' audio ' +
          stream.getAudioTracks().length +
          ' video ' +
          stream.getVideoTracks().length
      );

      // Create a new MediaStream if we don't have one
      if (!this.videoElement.srcObject) {
        this.videoElement.srcObject = new MediaStream();
      }

      // We might have one stream of both audio and video, or separate streams for audio and video
      for (const track of stream.getTracks()) {
        (this.videoElement.srcObject as MediaStream).addTrack(track);
      }
    }

    if (
      this.videoHealthMonitorEnabled &&
      event.track.kind === 'video' &&
      !this.videoHealthInterval
    ) {
      this.startVideoHealthMonitor();
    }
  }

  private startVideoHealthMonitor() {
    this.log('Starting video health monitor');
    this.lastFramesDecoded = 0;
    this.lastVideoPacketsReceived = 0;
    this.videoFreezeElapsedMs = 0;
    this.videoHealthInterval = setInterval(
      this.onVideoHealthCheck.bind(this),
      this.videoHealthPollIntervalMs
    );
  }

  private stopVideoHealthMonitor() {
    if (this.videoHealthInterval) {
      clearInterval(this.videoHealthInterval);
      this.videoHealthInterval = undefined;
    }
  }

  private async onVideoHealthCheck() {
    if (!this.peer || typeof this.peer.getStats !== 'function') {
      return;
    }

    // Don't flag a freeze when the caller has legitimately paused the video.
    if (this.videoElement.paused) {
      this.videoFreezeElapsedMs = 0;
      return;
    }

    let framesDecoded: number | undefined;
    let packetsReceived: number | undefined;
    const stats = await this.peer.getStats(null);
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        if (typeof report.framesDecoded === 'number') {
          framesDecoded = report.framesDecoded;
        }
        if (typeof report.packetsReceived === 'number') {
          packetsReceived = report.packetsReceived;
        }
      }
    });

    if (framesDecoded === undefined || packetsReceived === undefined) {
      return;
    }

    const framesAdvanced = framesDecoded > this.lastFramesDecoded;
    const packetsFlowing = packetsReceived > this.lastVideoPacketsReceived;
    this.lastFramesDecoded = framesDecoded;
    this.lastVideoPacketsReceived = packetsReceived;

    // A freeze is only a decoder problem worth recovering from when frames are
    // not advancing *despite* packets still arriving. If packets have also
    // stalled this is a network issue handled by the media-timeout logic, and
    // legitimately paused/muted playback is filtered out above.
    if (!framesAdvanced && packetsFlowing) {
      this.videoFreezeElapsedMs += this.videoHealthPollIntervalMs;
      if (this.videoFreezeElapsedMs >= this.videoFreezeThresholdMs) {
        this.recoverVideo();
        this.videoFreezeElapsedMs = 0;
      }
    } else {
      this.videoFreezeElapsedMs = 0;
    }
  }

  private recoverVideo() {
    const currentStream = this.videoElement.srcObject as MediaStream | null;
    if (!currentStream) {
      return;
    }
    this.log('Video appears frozen, attempting decoder recovery');
    this.emit(Message.VIDEO_RECOVERY_ATTEMPT);

    // Re-create the MediaStream from the existing tracks. Re-attaching the
    // tracks forces the decoder to reset and prompts a PLI/keyframe request.
    const tracks = currentStream.getTracks();
    const recovered = new MediaStream(tracks);
    this.videoElement.srcObject = recovered;
    const playPromise = this.videoElement.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => this.log('Recovery play() rejected', err));
    }
  }

  private async connect() {
    this.setupPeer();

    if (this.adapterType !== 'custom') {
      this.adapter = AdapterFactory(
        this.adapterType,
        this.peer,
        this.channelUrl,
        this.onErrorHandler.bind(this),
        this.mediaConstraints,
        this.authKey
      );
    } else if (this.adapterFactory) {
      this.adapter = this.adapterFactory(
        this.peer,
        this.channelUrl,
        this.onErrorHandler.bind(this),
        this.mediaConstraints,
        this.authKey
      );
    }
    if (!this.adapter) {
      throw new Error(`Failed to create adapter (${this.adapterType})`);
    }

    if (this.debug) {
      this.adapter.enableDebug();
    }

    this.statsInterval = setInterval(
      this.onConnectionStats.bind(this),
      this.msStatsInterval
    );
    try {
      await this.adapter.connect({ timeout: this.iceGatheringTimeoutMs });
    } catch (error) {
      console.error(error);
      this.stop();
    }
  }

  mute() {
    this.videoElement.muted = true;
  }

  unmute() {
    this.videoElement.muted = false;
  }

  async unload() {
    await this.adapter.disconnect();
    this.stop();
  }

  stop() {
    clearInterval(this.statsInterval);
    this.stopVideoHealthMonitor();
    // Closing the peer connection flips its signalingState to 'closed', which
    // the adapter observes to short-circuit any in-flight SDP exchange started
    // before the connection was established (see WHEPAdapter). Guard against a
    // peer that was never set up (e.g. stop()/destroy() called before load()).
    if (typeof this.peer.close === 'function') {
      this.peer.close();
    }
    this.videoElement.srcObject = null;
    this.videoElement.load();
  }

  destroy() {
    if (this.onlineListener && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = undefined;
    }
    this.stop();
    this.removeAllListeners();
  }
}
