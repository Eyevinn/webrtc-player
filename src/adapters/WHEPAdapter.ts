import { Adapter, AdapterConnectOptions } from './Adapter'

const DEFAULT_CONNECT_TIMEOUT = 2000;

export enum WHEPType {
  Client,
  Server
}

export class WHEPAdapter implements Adapter {
  private localPeer: RTCPeerConnection;
  private channelUrl: URL;
  private debug: boolean;
  private whepType: WHEPType;
  private waitingForCandidates: boolean;
  private iceGatheringTimeout: any;
  private resource: string;

  constructor(peer: RTCPeerConnection, channelUrl: URL, whepType: WHEPType = WHEPType.Client) {
    this.localPeer = peer;
    this.channelUrl = channelUrl;
    this.whepType = whepType;

    this.localPeer.onicegatheringstatechange = this.onIceGatheringStateChange.bind(this);
    this.localPeer.onicecandidate = this.onIceCandidate.bind(this);
  }

  enableDebug() {
    this.debug = true;
  }

  getPeer(): RTCPeerConnection {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    this.localPeer.addTransceiver('video', { direction: 'recvonly' });
    this.localPeer.addTransceiver('audio', { direction: 'recvonly' });
        
    if (this.whepType === WHEPType.Client) {
      const offer = await this.localPeer.createOffer();      
      await this.localPeer.setLocalDescription(offer);
      this.waitingForCandidates = true;
      this.iceGatheringTimeout = setTimeout(this.onIceGatheringTimeout.bind(this), DEFAULT_CONNECT_TIMEOUT);
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

    this.log(candidate.candidate);
  }

  private onIceGatheringStateChange(event: Event) {
    this.log("IceGatheringState", this.localPeer.iceGatheringState);
    if (this.localPeer.iceGatheringState !== 'complete' || !this.waitingForCandidates) {
      return;
    }

    this.onDoneWaitingForCandidates();
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
    
    if (this.whepType === WHEPType.Client) {
      await this.sendOffer();
    }
  }

  private async sendOffer() {
    const offer = this.localPeer.localDescription;

    if (this.whepType === WHEPType.Client) {
      const response = await fetch(this.channelUrl.href, { 
        method: "POST",
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (response.ok) {
        this.resource = response.headers.get("Location");
        this.log("WHEP Resource", this.resource);
        const answer = await response.text();
        await this.localPeer.setRemoteDescription({
          type: "answer",
          sdp: answer,
        });
      } else {
        this.error(`sendAnswer response: ${response.status}`);
      }
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
}
