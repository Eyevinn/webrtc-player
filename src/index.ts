import { Adapter } from "./adapters/Adapter";
import { AdapterFactory, AdapterFactoryFunction } from "./adapters/AdapterFactory";
import { EventEmitter } from "events";
import { CSAIManager } from "@eyevinn/csai-manager";

export { ListAvailableAdapters } from "./adapters/AdapterFactory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  vmapUrl?: string;
  statsTypeFilter?: string; // regexp
}

const RECONNECT_ATTEMPTS = 2;

export class WebRTCPlayer extends EventEmitter {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction;
  private iceServers: RTCIceServer[];
  private debug: boolean;
  private channelUrl: URL;
  private reconnectAttemptsLeft: number = RECONNECT_ATTEMPTS;
  private csaiManager?: CSAIManager;
  private adapter: Adapter;
  private statsInterval: any;
  private statsTypeFilter: string;
  private bytesReceived: number = 0;

  constructor(opts: WebRTCPlayerOptions) {
    super();
    this.videoElement = opts.video;
    this.adapterType = opts.type;
    this.adapterFactory = opts.adapterFactory;
    this.statsTypeFilter = opts.statsTypeFilter;

    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (opts.iceServers) {
      this.iceServers = opts.iceServers;
    }
    this.debug = !!opts.debug;
    if (opts.vmapUrl) {
      this.csaiManager = new CSAIManager({
        contentVideoElement: this.videoElement,
        vmapUrl: opts.vmapUrl,
        isLive: true,
        autoplay: true,
      });
      this.videoElement.addEventListener("ended", () => {
        this.csaiManager.destroy();
      });
    }
  }

  async load(channelUrl: URL) {
    this.channelUrl = channelUrl;
    this.connect();
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log("WebRTC-player", ...args);
    }
  }

  private error(...args: any[]) {
    console.error("WebRTC-player", ...args);
  }

  private async onConnectionStateChange(e) {

    if (this.peer.connectionState === 'failed') {
      this.peer && this.peer.close();

      if (this.reconnectAttemptsLeft <= 0) {
        this.error('Connection failed, reconnecting failed');
        return;
      }

      this.log(`Connection failed, recreating peer connection, attempts left ${this.reconnectAttemptsLeft}`);
      await this.connect();
      this.reconnectAttemptsLeft--;

    } else if (this.peer.connectionState === 'connected') {
      this.log("Connected");
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
    }
  }

  private onErrorHandler(error: string) {
    this.log(`onError=${error}`);
    switch (error) {
      case "reconnectneeded":
        this.peer && this.peer.close();
        this.videoElement.srcObject = undefined;
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

        if (report.type.match('inbound-rtp')) {
            this.emit(`stats:${report.type}`, report);
            bytesReceivedBlock += report.bytesReceived;
        }

      });

      if (bytesReceivedBlock <= this.bytesReceived) {
        this.emit('media reception ended');
      }
      else {
        this.bytesReceived = bytesReceivedBlock;
      }
    }
  }

  private setupPeer() {
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer.onconnectionstatechange = this.onConnectionStateChange.bind(this);
    this.peer.ontrack = this.onTrack.bind(this);
  }

  private onTrack(event: RTCTrackEvent) {
    for (let stream of event.streams) {
      if (stream.id === 'feedbackvideomslabel' || this.videoElement.srcObject) {
        continue;
      }

      console.log('Set video element remote stream to ' + stream.id, ' audio ' + stream.getAudioTracks().length + ' video ' + stream.getVideoTracks().length);
      this.videoElement.srcObject = stream;
    }
  }

  private async connect() {
    this.setupPeer();

    if (this.adapterType !== "custom") {
      this.adapter = AdapterFactory(this.adapterType,
        this.peer, this.channelUrl, this.onErrorHandler.bind(this));
    } else if (this.adapterFactory) {
      this.adapter = this.adapterFactory(this.peer, this.channelUrl,
        this.onErrorHandler.bind(this));
    }
    if (!this.adapter) {
      throw new Error(`Failed to create adapter (${this.adapterType})`)
    }

    if (this.debug) {
      this.adapter.enableDebug();
    }

    this.statsInterval = setInterval(this.onConnectionStats.bind(this), 5000);
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
    this.videoElement.src = null;
    this.videoElement.load();
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}
