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
  PEER_CONNECTION_FAILED = 'peer-connection-failed'
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
}

interface VideoEventData {
  type: string;
  currentTime: number;
  duration: number;
  paused: boolean;
}

interface MediaStreamEvent extends Event {
  target: HTMLVideoElement;
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
  private statsInterval: any;
  private statsTypeFilter: string | undefined = undefined;
  private msStatsInterval: number = 5000;
  private mediaTimeoutOccured: boolean = false;
  private mediaTimeoutThreshold: number = 30000;
  private timeoutThresholdCounter: number = 0;
  private bytesReceived: number = 0;
  private stream: MediaStream;

  constructor(opts: WebRTCPlayerOptions) {
    super();
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

      const events = [
        'play',
        'pause',
        'seeking',
        'seeked',
        'timeupdate',
        'ended',
        'volumechange',
        'enterpictureinpicture',
        'leavepictureinpicture',
        'loadedmetadata',
        'fullscreenchange'
      ];

      events.forEach((event) => {
        this.videoElement.addEventListener(event, this.handleVideoEvent as EventListener);
      });


    // Function to receive events from the WebView
    (window as any).receiveMessageFromWebView = function (eventData: VideoEventData): void {
      const video = document.querySelector('video');
      if (!video) return;

      switch (eventData.type) {
        case 'play':
          video.play();
          break;
        case 'mute':
          video.volume = 0;
          break;
        case 'unmute':
          video.volume = 1;
          break;
        case 'enterpictureinpicture':
          video.requestPictureInPicture();
          break;
        case 'leavepictureinpicture':
          document.exitPictureInPicture();
          break;
        case 'pause':
          video.pause();
          break;
        case 'seek':
          video.currentTime = eventData.currentTime;
          break;
        default:
          console.error(`Unsupported event type: ${eventData.type}`);
      }
    };

    // Create the webviewMessageChannel MessageChannel object
    const webviewMessageChannel = new MessageChannel();
    if ((window as any).webkit && (window as any).webkit.messageHandlers) {
      (window as any).webkit.messageHandlers.webviewMessageChannel = webviewMessageChannel.port1;
    }
    this.stream = new MediaStream();
  }

  async load(channelUrl: URL) {
    this.channelUrl = channelUrl;
    this.connect();
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log('WebRTC-player', ...args);
    }
  }


  // Function to handle video events and pass them to the iOS/Android listener
  private handleVideoEvent(event: MediaStreamEvent): void {
    const videoData: VideoEventData = {
      type: event.type,
      currentTime: event.target.currentTime,
      duration: event.target.duration,
      paused: event.target.paused
    };
    // Check if iOS WebView environment
    if ((window as any).webkit && (window as any).webkit.messageHandlers) {
      (window as any).webkit.messageHandlers.webviewMessageChannel.postMessage(videoData);
    } else {
      // For Android WebView environment
      //window.postMessage(videoData, '*');
      try {
        // @ts-ignore
        Android.postMessage(JSON.stringify(videoData), '*');
      } catch(err) {
        // no need to report errors as this is a common occurance since it's an injected variable by the Android webview.
      }
    }
  }


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
      this.videoElement.srcObject = this.stream;
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
    }
  }

  private async onConnectionStats() {
    if (this.peer && this.statsTypeFilter) {
      let bytesReceivedBlock: number = 0;
      let stats = await this.peer.getStats(null);

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
    const track = event.track;
    const currentTracks = this.stream.getTracks();
    const streamAlreadyHasVideoTrack = currentTracks.some(
      (track) => track.kind === 'video'
    );
    const streamAlreadyHasAudioTrack = currentTracks.some(
      (track) => track.kind === 'audio'
    );
    switch (track.kind) {
      case 'video':
        if (streamAlreadyHasVideoTrack) {
          break;
        }
        console.log('Added a video track');
        this.stream.addTrack(track);
        break;
      case 'audio':
        if (streamAlreadyHasAudioTrack) {
          break;
        }
        console.log('Added a audio track');
        this.stream.addTrack(track);
        break;
      default:
        console.log('got unknown track ' + track);
    }
  }

  private async connect() {
    this.setupPeer();

    if (this.adapterType !== 'custom') {
      this.adapter = AdapterFactory(
        this.adapterType,
        this.peer,
        this.channelUrl,
        this.onErrorHandler.bind(this)
      );
    } else if (this.adapterFactory) {
      this.adapter = this.adapterFactory(
        this.peer,
        this.channelUrl,
        this.onErrorHandler.bind(this)
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
    await this.adapter.connect();
  }

  mute() {
    this.videoElement.muted = true;
  }

  unmute() {
    this.videoElement.muted = false;
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
