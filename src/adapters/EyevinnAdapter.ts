import { Adapter, AdapterConnectOptions } from './Adapter'

const DEFAULT_CONNECT_TIMEOUT = 2000;


export class EyevinnAdapter implements Adapter {
  private localPeer: RTCPeerConnection;
  private channelUrl: URL;
  private debug: boolean;
  private iceGatheringTimeout: any;
  private waitingForCandidates: boolean = false;
  private resourceUrl: URL | undefined = undefined;

  constructor(peer: RTCPeerConnection, channelUrl: URL, onError: (error: string) => void) {
    this.channelUrl = channelUrl;
    this.debug = true;
    this.resetPeer(peer);
  }

  enableDebug() {
    this.debug = true;
  }

  resetPeer(newPeer: RTCPeerConnection) {
    this.localPeer = newPeer;
    this.localPeer.onicegatheringstatechange = this.onIceGatheringStateChange.bind(this);
    this.localPeer.oniceconnectionstatechange =
      this.onIceConnectionStateChange.bind(this);
    this.localPeer.onicecandidateerror = this.onIceCandidateError.bind(this);
    this.localPeer.onicecandidate = this.onIceCandidate.bind(this);
  }

  getPeer(): RTCPeerConnection {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    this.localPeer.addTransceiver("video", { direction: "recvonly" });
    this.localPeer.addTransceiver("audio", { direction: "recvonly" });

    const offer = await this.localPeer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    this.localPeer.setLocalDescription(offer);

    this.waitingForCandidates = true;
    this.iceGatheringTimeout = setTimeout(this.onIceGatheringTimeout.bind(this), (opts && opts.timeout) || DEFAULT_CONNECT_TIMEOUT);
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log("WebRTC-player", ...args);
    }
  }

  private error(...args: any[]) {
    console.error("WebRTC-player", ...args);
  }

  private onIceGatheringStateChange(event: Event) {
    this.log("IceGatheringState", this.localPeer.iceGatheringState);

    if (this.localPeer.iceGatheringState !== 'complete' || !this.waitingForCandidates) {
      return;
    }

    this.onDoneWaitingForCandidates();
  }

  private onIceConnectionStateChange(e) {
    this.log("IceConnectionState", this.localPeer.iceConnectionState);

    if (this.localPeer.iceConnectionState === 'failed') {
      this.localPeer.close();
    }
  }

  private async onIceCandidate(event: Event) {
    if (event.type !== 'icecandidate') {
      return;
    }
    const candidateEvent = <RTCPeerConnectionIceEvent>(event);
    const candidate: RTCIceCandidate | null = candidateEvent.candidate;
    if (!candidate) {
      return;
    }

    this.log("IceCandidate", candidate.candidate);
  }

  private onIceCandidateError(e) {
    this.log("IceCandidateError", e);
  }

  private onIceGatheringTimeout() {
    this.log("IceGatheringTimeout");

    if (!this.waitingForCandidates) {
      return;
    }

    this.onDoneWaitingForCandidates();
  }

  private async onDoneWaitingForCandidates() {
    this.waitingForCandidates = false;
    clearTimeout(this.iceGatheringTimeout);

    const response = await fetch(this.channelUrl.href, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sdp: this.localPeer.localDescription.sdp })
      });
      if (response.ok) {
        const { sdp } = await response.json();
        this.localPeer.setRemoteDescription({ type: "answer", sdp: sdp });
      }
  }
}
