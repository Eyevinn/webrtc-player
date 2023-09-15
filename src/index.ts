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
  INITIAL_CONNECTION_FAILED = 'initial-connection-failed'
}

export interface MediaConstraints {
  audioOnly?: boolean;
  videoOnly?: boolean;
}

const MediaConstraintsDefaults: MediaConstraints = {
  audioOnly: false,
  videoOnly: false
}

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  vmapUrl?: string;
  statsTypeFilter?: string; // regexp
  detectTimeout?: boolean;
  timeoutThreshold?: number;
  mediaConstraints?: MediaConstraints;
}

const RECONNECT_ATTEMPTS = 2;

export class WebRTCPlayer extends EventEmitter {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection = <RTCPeerConnection>{};
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction | undefined = undefined;
  private iceServers: RTCIceServer[];
  private debug: boolean;
  private channelUrl: URL = <URL>{};
  private reconnectAttemptsLeft: number = RECONNECT_ATTEMPTS;
  private csaiManager?: CSAIManager;
  private adapter: Adapter = <Adapter>{};
  private statsInterval: ReturnType<typeof setInterval> | undefined;
  private statsTypeFilter: string | undefined = undefined;
  private msStatsInterval = 5000;
  private mediaTimeoutOccured = false;
  private mediaTimeoutThreshold = 30000;
  private timeoutThresholdCounter = 0;
  private bytesReceived = 0;
  private mediaConstraints: MediaConstraints;

  constructor(opts: WebRTCPlayerOptions) {
    super();
    this.mediaConstraints = { ...MediaConstraintsDefaults, ...opts.mediaConstraints };
    this.videoElement = opts.video;
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
  }

  async load(channelUrl: URL) {
    this.channelUrl = channelUrl;
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
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
    }
  }

  private onErrorHandler(error: string) {
    this.log(`onError=${error}`);
    switch (error) {
      case 'reconnectneeded':
        this.peer && this.peer.close();
        this.videoElement.srcObject = null;
        this.setupPeer();
        this.adapter.resetPeer(this.peer);
        this.adapter.connect();
        break;
      case 'connectionfailed':
        this.peer && this.peer.close();
        this.videoElement.srcObject = null;
        this.emit(Message.INITIAL_CONNECTION_FAILED);
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
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer.onconnectionstatechange = this.onConnectionStateChange.bind(this);
    this.peer.ontrack = this.onTrack.bind(this);
  }

  private onTrack(event: RTCTrackEvent) {
    for (const stream of event.streams) {
      if (stream.id === 'feedbackvideomslabel' || this.videoElement.srcObject) {
        continue;
      }

      console.log(
        'Set video element remote stream to ' + stream.id,
        ' audio ' +
          stream.getAudioTracks().length +
          ' video ' +
          stream.getVideoTracks().length
      );
      this.videoElement.srcObject = stream;
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
        this.mediaConstraints
      );
    } else if (this.adapterFactory) {
      this.adapter = this.adapterFactory(
        this.peer,
        this.channelUrl,
        this.onErrorHandler.bind(this),
        this.mediaConstraints
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
      await this.adapter.connect();
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
    this.peer.close();
    this.videoElement.srcObject = null;
    this.videoElement.load();
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}
