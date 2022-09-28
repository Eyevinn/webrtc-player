import { Adapter } from "./adapters/Adapter";
import { AdapterFactory, AdapterFactoryFunction } from "./adapters/AdapterFactory";
import { EventEmitter } from "events";
import { CSAIManager } from "@eyevinn/csai-manager";

export { ListAvailableAdapters } from "./adapters/AdapterFactory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  vmapUrl?: string;
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
  private stream: MediaStream;
  private adapter: Adapter;

  constructor(opts: WebRTCPlayerOptions) {
    super();
    this.videoElement = opts.video;
    this.adapterType = opts.type;
    this.adapterFactory = opts.adapterFactory;

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

  private onConnectionStateChange(e) {
    if (this.peer.connectionState === 'failed') {
      this.peer && this.peer.close();

      if (this.reconnectAttemptsLeft <= 0) {
        this.error('Connection failed, reconnecting failed');
        return;
      }

      this.log(`Connection failed, recreating peer connection, attempts left ${this.reconnectAttemptsLeft}`);
      this.connect();
      this.reconnectAttemptsLeft--;

    } else if (this.peer.connectionState === 'connected') {
      this.log("Connected");
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
      if (!this.videoElement.srcObject) {
        this.log("Updating video element srcobject");
				this.videoElement.srcObject = this.stream;
			}
    }
  }

  private onErrorHandler(error: string) {
    this.log(`onError=${error}`);
    switch(error) {
      case "reconnectneeded":
        this.peer && this.peer.close();
        this.videoElement.srcObject = undefined;
        this.setupPeer();
        this.adapter.resetPeer(this.peer);
        this.adapter.connect();
        break;
    }
  }

  private setupPeer() {
    this.stream = new MediaStream();
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer.onconnectionstatechange = this.onConnectionStateChange.bind(this);
    this.peer.ontrack = this.onTrack.bind(this);
  }

  private onTrack(ev) {
    const track = ev.track;
    switch (track.kind) {
      case 'video':
        if (track.label !== 'feedbackvideolabel') {
          const newTrack = track.clone();
          this.log("Adding video track", newTrack);
          this.stream.addTrack(newTrack);
        }
        break;
      case 'audio':
        const newTrack = track.clone();
        this.log("Adding audio track", newTrack);
        this.stream.addTrack(newTrack);
        break;
      default:
        this.log('unknown track', track);
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
    
    await this.adapter.connect();
  }

  mute() {
    this.videoElement.muted = true;
  }

  unmute() {
    this.videoElement.muted = false;
  }

  stop() {
    this.peer.close(); 
    this.videoElement.src = null;
    this.videoElement.load();
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }
}
