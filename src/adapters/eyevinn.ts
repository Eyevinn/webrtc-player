import { BaseAdapter } from "./base";

export class EyevinnAdapter extends BaseAdapter {
  constructor(peer: RTCPeerConnection, channelUrl: URL) {
    super(peer, channelUrl);
  }

  // Overload SDP exchange method
  async exchangeSdp() {
    const response = await fetch(this.channelUrl.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sdp: this.localPeer.localDescription.sdp })
    });
    if (response.ok) {
      const { sdp } = await response.json();
      this.localPeer.setRemoteDescription({ type: "answer", sdp: sdp });
    }
  }
}