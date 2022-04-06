import { AdapterFactory } from "./adapters/factory";

interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
  type: string;
}

export class WebRTCPlayer {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;
  private adapterType: string;

  constructor(opts: WebRTCPlayerOptions) {
    this.videoElement = opts.video;
    this.adapterType = opts.type;
  }

  async load(channelUrl: URL) {
    this.peer = new RTCPeerConnection();
    const adapter = AdapterFactory(this.adapterType, this.peer, channelUrl);

    this.peer.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        this.videoElement.srcObject = ev.streams[0];
      }
    };

    const offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    this.peer.setLocalDescription(offer);
  }

  mute() {
    this.videoElement.muted = true;
  }

  unmute() {
    this.videoElement.muted = false;
  }

}