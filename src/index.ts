import { Adapter } from "./adapters/Adapter";
import { AdapterFactory, AdapterFactoryFunction } from "./adapters/AdapterFactory";
import { EventEmitter } from "events";

export { ListAvailableAdapters } from "./adapters/AdapterFactory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  createDataChannels?: string[];
}

const RECONNECT_ATTEMPTS = 2;

export class WebRTCPlayer extends EventEmitter {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction;
  private iceServers: RTCIceServer[];
  private debug: boolean;
  private createDataChannels: string[];
  private rtcDataChannels: RTCDataChannel[];
  private channelUrl: URL;
  private reconnectAttemptsLeft: number = RECONNECT_ATTEMPTS;

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
    this.createDataChannels = opts.createDataChannels || [];
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
      this.reconnectAttemptsLeft = RECONNECT_ATTEMPTS;
    }
  }

  private async connect() {
    let adapter: Adapter;
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer.onconnectionstatechange = this.onConnectionStateChange.bind(this);

    if (this.adapterType !== "custom") {
      adapter = AdapterFactory(this.adapterType, this.peer, this.channelUrl);
    } else if (this.adapterFactory) {
      adapter = this.adapterFactory(this.peer, this.channelUrl);
    }
    if (!adapter) {
      throw new Error(`Failed to create adapter (${this.adapterType})`)
    }

    if (this.debug) {
      adapter.enableDebug();
    }

    this.peer.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        this.videoElement.srcObject = ev.streams[0];
      }
    };
    if (this.createDataChannels) {
      this.rtcDataChannels = adapter.setupDataChannels(this.createDataChannels);
      this.rtcDataChannels.forEach(channel => {
        channel.onmessage = (ev) => {
          this.emit("message", ev.data);
        }
      });
    }
    await adapter.connect();
  }

  send(channelLabel: string, data: any) {
    const rtcDataChannel = this.rtcDataChannels.find(channel => channel.label === channelLabel);
    if (!rtcDataChannel) {
      return;
    }
    if (rtcDataChannel.readyState !== "open") {
      return;
    }

    rtcDataChannel.send(JSON.stringify(data));
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
