export class BaseAdapter {
  protected localPeer: RTCPeerConnection;
  protected channelUrl: URL;

  constructor(peer: RTCPeerConnection, channelUrl: URL) {
    this.localPeer = peer;
    this.channelUrl = channelUrl;
  }

  async connect() {
    const offer = await this.localPeer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    this.localPeer.setLocalDescription(offer);
  }
}