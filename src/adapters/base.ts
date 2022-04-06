const DEFAULT_CONNECT_TIMEOUT = 2000;

export interface AdapterConnectOptions {
  timeout: number;
}

export class BaseAdapter {
  protected localPeer: RTCPeerConnection;
  protected channelUrl: URL;
  private debug: boolean;
  private iceGatheringTimeout: NodeJS.Timeout;
  private iceGatheringComplete: boolean;

  constructor(peer: RTCPeerConnection, channelUrl: URL) {
    this.localPeer = peer;
    this.channelUrl = channelUrl;
    this.debug = false;

    this.localPeer.onicegatheringstatechange = this.onIceGatheringStateChange.bind(this);
    this.localPeer.oniceconnectionstatechange =
      this.onIceConnectionStateChange.bind(this);
    this.localPeer.onicecandidateerror = this.onIceCandidateError.bind(this);
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log("WebRTC-player", ...args);
    }
  }

  private error(...args: any[]) {
    console.error("WebRTC-player", ...args);
  }

  private onIceGatheringStateChange(e) {
    this.log("IceGatheringState", this.localPeer.iceGatheringState);
  }

  private onIceConnectionStateChange(e) {
    this.log("IceConnectionState", this.localPeer.iceConnectionState);
  }

  private async onIceCandidate({ candidate }) {
    if (candidate === null) {
      // ICE gathering is complete
      clearTimeout(this.iceGatheringTimeout);

      this.localPeer.removeEventListener("icecandidate", this.onIceCandidate.bind(this));
      this.onIceGatheringComplete();
    } else {
      this.log("IceCandidate", candidate.candidate);
    }
  }

  private onIceCandidateError(e) {
    this.log("IceCandidateError", e);
  }

  private onIceGatheringTimeout() {
    this.log("IceGatheringTimeout");
    clearTimeout(this.iceGatheringTimeout);

    this.localPeer.removeEventListener("icecandidate", this.onIceCandidate.bind(this));
    this.onIceGatheringComplete();
  }

  private async onIceGatheringComplete() {
    if (this.iceGatheringComplete) {
      return;
    }
    this.log("IceGatheringComplete");

    this.iceGatheringComplete = true;
    await this.exchangeSdp();
  }

  protected async exchangeSdp() {
    throw new Error("Adapter must implement a way to exchange SDPs");
  }

  async connect(opts?: AdapterConnectOptions) {
    const offer = await this.localPeer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    this.localPeer.setLocalDescription(offer);

    this.localPeer.addEventListener("icecandidate", this.onIceCandidate.bind(this));
    this.iceGatheringComplete = false;
    this.iceGatheringTimeout = setTimeout(this.onIceGatheringTimeout.bind(this), (opts && opts.timeout) || DEFAULT_CONNECT_TIMEOUT);
  }

  enableDebug() {
    this.debug = true;
  }

  getPeer() {
    return this.localPeer;
  }
}