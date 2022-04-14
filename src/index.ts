import { BaseAdapter } from "./adapters/base";
import { AdapterFactory, AdapterFactoryFunction } from "./adapters/factory";

export { BaseAdapter } from "./adapters/base";
export { ListAvailableAdapters } from "./adapters/factory";

import { EventEmitter } from "events";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  adapterFactory?: AdapterFactoryFunction;
  iceServers?: RTCIceServer[];
  debug?: boolean;
  createDataChannels?: string[];
}

export class WebRTCPlayer extends EventEmitter {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;
  private adapterFactory: AdapterFactoryFunction;
  private iceServers: RTCIceServer[];
  private debug: boolean;
  private createDataChannels: string[];
  private rtcDataChannels: RTCDataChannel[];

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