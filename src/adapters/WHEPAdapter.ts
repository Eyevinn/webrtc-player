import { Adapter, AdapterConnectOptions } from './Adapter';

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
  private onErrorHandler: (error: string) => void;
  private audio: boolean;

  constructor(
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void
  ) {
    this.channelUrl = channelUrl;
    this.whepType = WHEPType.Client;

    this.onErrorHandler = onError;
    this.audio = true;
    this.resetPeer(peer);
  }

  enableDebug() {
    this.debug = true;
  }

  resetPeer(newPeer: RTCPeerConnection) {
    this.localPeer = newPeer;
    this.localPeer.onicegatheringstatechange =
      this.onIceGatheringStateChange.bind(this);
    this.localPeer.onicecandidate = this.onIceCandidate.bind(this);
  }

  getPeer(): RTCPeerConnection {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    await this.initSdpExchange();
  }

  private async initSdpExchange() {
    clearTimeout(this.iceGatheringTimeout);

    if (this.whepType === WHEPType.Client) {
      this.localPeer.addTransceiver('video', { direction: 'recvonly' });
      if (this.audio)
        this.localPeer.addTransceiver('audio', { direction: 'recvonly' });
      const offer = await this.localPeer.createOffer();
      await this.localPeer.setLocalDescription(offer);
      this.waitingForCandidates = true;
      this.iceGatheringTimeout = setTimeout(
        this.onIceGatheringTimeout.bind(this),
        DEFAULT_CONNECT_TIMEOUT
      );
    } else {
      const offer = await this.requestOffer();
      await this.localPeer.setRemoteDescription({
        type: 'offer',
        sdp: offer
      });
      const answer = await this.localPeer.createAnswer();
      await this.localPeer.setLocalDescription(answer);
      this.waitingForCandidates = true;
      this.iceGatheringTimeout = setTimeout(
        this.onIceGatheringTimeout.bind(this),
        DEFAULT_CONNECT_TIMEOUT
      );
    }
  }

  private async onIceCandidate(event: Event) {
    if (event.type !== 'icecandidate') {
      return;
    }
    const candidateEvent = <RTCPeerConnectionIceEvent>event;
    const candidate: RTCIceCandidate | null = candidateEvent.candidate;
    if (!candidate) {
      return;
    }

    this.log(candidate.candidate);
  }

  private onIceGatheringStateChange(event: Event) {
    this.log('IceGatheringState', this.localPeer.iceGatheringState);
    if (
      this.localPeer.iceGatheringState !== 'complete' ||
      !this.waitingForCandidates
    ) {
      return;
    }

    this.onDoneWaitingForCandidates();
  }

  private onIceGatheringTimeout() {
    this.log('IceGatheringTimeout');

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
    } else {
      await this.sendAnswer();
    }
  }

  private async requestOffer() {
    if (this.whepType === WHEPType.Server) {
      const response = await fetch(this.channelUrl.href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: ''
      });
      if (response.ok) {
        this.resource = response.headers.get('Location');
        this.log('WHEP Resource', this.resource);
        const offer = await response.text();
        return offer;
      }
    }
  }

  private async sendAnswer() {
    if (this.whepType === WHEPType.Server) {
      const answer = this.localPeer.localDescription;
      const response = await fetch(this.resource, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: answer.sdp
      });
      if (!response.ok) {
        this.error(`sendAnswer response: ${response.status}`);
      }
    }
  }

  private async sendOffer() {
    const offer = this.localPeer.localDescription;

    if (this.whepType === WHEPType.Client) {
      const response = await fetch(this.channelUrl.href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (response.ok) {
        this.resource = response.headers.get('Location');
        this.log('WHEP Resource', this.resource);
        const answer = await response.text();
        await this.localPeer.setRemoteDescription({
          type: 'answer',
          sdp: answer
        });
      } else if (response.status === 400) {
        this.log(`Maybe there is startup delay, Let's reconnect`);
        this.onErrorHandler('reconnectneeded');
      } else if (response.status === 406 && this.audio) {
        this.log(`maybe server does not support audio. Let's retry without audio`);
        this.audio = false;
        this.onErrorHandler('reconnectneeded');
      } else {
        this.error(`sendAnswer response: ${response.status}`);
      }
    }
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log('WebRTC-player', ...args);
    }
  }

  private error(...args: any[]) {
    console.error('WebRTC-player', ...args);
  }
}
