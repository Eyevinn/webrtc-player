import { BaseAdapter } from "./adapters/base";
import { AdapterFactory, AdapterFactoryFunction } from "./adapters/factory";

export { BaseAdapter } from "./adapters/base";
export { AdapterFactoryFunction } from "./adapters/factory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
}

export class WebRTCPlayer {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction;
  private iceServers: RTCIceServer[];
  private debug: boolean;

  constructor(opts: WebRTCPlayerOptions) {
    this.videoElement = opts.video;
    this.adapterType = opts.type;
    this.adapterFactory = opts.adapterFactory;

    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (opts.iceServers) {
      this.iceServers = opts.iceServers;
    }
    this.debug = !!opts.debug;
  }

  async load(channelUrl: URL) {
    let adapter: BaseAdapter;
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    
    if (this.adapterType !== "custom") {
      adapter = AdapterFactory(this.adapterType, this.peer, channelUrl);
    } else if (this.adapterFactory) {
      adapter = this.adapterFactory(this.peer, channelUrl);
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
    await adapter.connect();
  }

  mute() {
    this.videoElement.muted = true;
  }

  unmute() {
    this.videoElement.muted = false;
  }

}