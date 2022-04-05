interface WebRTCPlayerOptions {
  video: HTMLVideoElement;
}

export class WebRTCPlayer {
  private videoElement: HTMLVideoElement;
  private peer: RTCPeerConnection;

  constructor(opts: WebRTCPlayerOptions) {
    this.videoElement = opts.video;
  }

  async load(channelUrl: URL) {
    this.peer = new RTCPeerConnection();
    this.peer.onicecandidate = async (event) => {
      if (event.candidate === null) {
        const response = await fetch(channelUrl.href, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ sdp: this.peer.localDescription.sdp })
        });
        if (response.ok) {
          const { sdp } = await response.json();
          this.peer.setRemoteDescription({ type: "answer", sdp: sdp });
        }
      }
    };
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