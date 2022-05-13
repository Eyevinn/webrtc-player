import { Adapter, AdapterConnectOptions } from './Adapter'

const DEFAULT_CONNECT_TIMEOUT = 2000;

interface EyevinnCandidateRequest {
  candidate: string;
}

interface EyevinnAnswerRequest {
  answer: string;
}

interface EyevinnMediaStream {
  streamId: string;
}

interface EyevinnOfferResponse {
  offer: string;
  mediaStreams: EyevinnMediaStream[];
}

export class EyevinnAdapter implements Adapter {
  private localPeer: RTCPeerConnection;
  private channelUrl: URL;
  private debug: boolean;
  private iceGatheringTimeout: any;
  private waitingForCandidates: boolean = false;
  private resourceUrl: URL | undefined = undefined;

  constructor(peer: RTCPeerConnection, channelUrl: URL) {
    this.localPeer = peer;
    this.channelUrl = channelUrl;
    this.debug = true;

    this.localPeer.onicegatheringstatechange = this.onIceGatheringStateChange.bind(this);
    this.localPeer.oniceconnectionstatechange =
      this.onIceConnectionStateChange.bind(this);
    this.localPeer.onicecandidateerror = this.onIceCandidateError.bind(this);
    this.localPeer.onicecandidate = this.onIceCandidate.bind(this);
  }

  setupDataChannels(labels: string[]): RTCDataChannel[] {
    const channels = labels.map(label => this.localPeer.createDataChannel(label));
    return channels;
  }

  enableDebug() {
    this.debug = true;
  }

  getPeer(): RTCPeerConnection {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    const response = await fetch(this.channelUrl.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: '{}'
    });

    if (!response.ok) {
      return;
    }

    const offerResponse = <EyevinnOfferResponse>await response.json();
    const locationHeader = response.headers.get('location');
    this.resourceUrl = new URL(locationHeader);

    if (!this.supportsTrickleIce()) {
      this.waitingForCandidates = true;
    }

    await this.localPeer.setRemoteDescription({type: 'offer', sdp: offerResponse.offer});

    const answer = await this.localPeer.createAnswer();
    await this.localPeer.setLocalDescription(answer);

    if (this.supportsTrickleIce()) {
      await this.sendAnswer();
    } else {
      this.iceGatheringTimeout = setTimeout(this.onIceGatheringTimeout.bind(this), (opts && opts.timeout) || DEFAULT_CONNECT_TIMEOUT);
    }
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

    if (this.localPeer.iceGatheringState !== 'complete' || this.supportsTrickleIce() || !this.waitingForCandidates) {
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

    if (!this.supportsTrickleIce()) {
      return;
    }

    this.sendCandidate(candidate);
  }

  private onIceCandidateError(e) {
    this.log("IceCandidateError", e);
  }

  private onIceGatheringTimeout() {
    this.log("IceGatheringTimeout");

    if (this.supportsTrickleIce() || !this.waitingForCandidates) {
      return;
    }

    this.onDoneWaitingForCandidates();
  }

  private async onDoneWaitingForCandidates() {
    this.waitingForCandidates = false;
    clearTimeout(this.iceGatheringTimeout);

    await this.sendAnswer();
  }

  private supportsTrickleIce(): boolean {
    return false;
  }

  private async sendCandidate(rtcIceCandidate: RTCIceCandidate) {
    const candidateRequest: EyevinnCandidateRequest = {
      candidate: rtcIceCandidate.candidate
    };

    const response = await fetch(this.resourceUrl.href, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(candidateRequest)
    });

    if (!response.ok) {
      this.error(`sendCandidate response: ${response.status}`);
    }
  }

  private async sendAnswer() {
    const answer = this.localPeer.localDescription;

    const answerRequest:EyevinnAnswerRequest = {
      answer: answer.sdp
    }

    const response = await fetch(this.resourceUrl.href, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(answerRequest)
    });

    if (!response.ok) {
      this.error(`sendAnswer response: ${response.status}`);
    }
  }
}
