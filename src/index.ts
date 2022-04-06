import { AdapterFactory } from "./adapters/factory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
  iceServers?: RTCIceServer[];
}

export class WebRTCPlayer {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;
  private iceServers: RTCIceServer[];

  constructor(opts: WebRTCPlayerOptions) {
    this.videoElement = opts.video;
    this.adapterType = opts.type;
    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (opts.iceServers) {
      this.iceServers = opts.iceServers;
    }
  }

  async load(channelUrl: URL) {
    this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
    const adapter = AdapterFactory(this.adapterType, this.peer, channelUrl);

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