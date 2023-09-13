import { Adapter, AdapterConnectOptions } from './Adapter';
import { WebRTCPlayerOptions } from '../index';

const DEFAULT_CONNECT_TIMEOUT = 2000;

export enum WHEPType {
  Client,
  Server
}

export class WHEPAdapter implements Adapter {
  private localPeer: RTCPeerConnection | undefined;
  private channelUrl: URL;
  private debug = false;
  private whepType: WHEPType;
  private waitingForCandidates = false;
  private iceGatheringTimeout: ReturnType<typeof setTimeout> | undefined;
  private resource: string | null = null;
  private onErrorHandler: (error: string) => void;
  private audio: boolean;
  private video: boolean;
  private opts: WebRTCPlayerOptions;

  constructor(
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void,
    opts: WebRTCPlayerOptions
  ) {
    this.opts = opts;
    this.channelUrl = channelUrl;
    if (typeof this.channelUrl === 'string') {
      throw new Error(
        `channelUrl parameter expected to be an URL not a string`
      );
    }
    this.whepType = WHEPType.Client;

    this.onErrorHandler = onError;
    this.audio = !this.opts.videoOnly;
    this.video = !this.opts.audioOnly;
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

  getPeer(): RTCPeerConnection | undefined {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    try {
      await this.initSdpExchange();
    } catch (error) {
      console.error((error as Error).toString());
    }
  }

  async disconnect() {
    if (this.resource) {
      this.log(`Disconnecting by removing resource ${this.resource}`);
      const response = await fetch(this.resource, {
        method: 'DELETE'
      });
      if (response.ok) {
        this.log(`Successfully removed resource`);
      }
    }
  }

  private async initSdpExchange() {
    clearTimeout(this.iceGatheringTimeout);

    if (this.localPeer && this.whepType === WHEPType.Client) {
      if (this.video)
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
      if (this.localPeer) {
        const offer = await this.requestOffer();
        await this.localPeer.setRemoteDescription({
          type: 'offer',
          sdp: offer
        });
        const answer = await this.localPeer.createAnswer();
        try {
          await this.localPeer.setLocalDescription(answer);
          this.waitingForCandidates = true;
          this.iceGatheringTimeout = setTimeout(
            this.onIceGatheringTimeout.bind(this),
            DEFAULT_CONNECT_TIMEOUT
          );
        } catch (error) {
          this.log(answer.sdp);
          throw error;
        }
      }
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
    if (this.localPeer) {
      this.log('IceGatheringState', this.localPeer.iceGatheringState);
      if (
        this.localPeer.iceGatheringState !== 'complete' ||
        !this.waitingForCandidates
      ) {
        return;
      }

      this.onDoneWaitingForCandidates();
    }
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

  private getResouceUrlFromHeaders(headers: Headers): string | null {
    if (headers.get('Location') && headers.get('Location')?.match(/^\//)) {
      const resourceUrl = new URL(
        headers.get('Location')!,
        this.channelUrl.origin
      );
      return resourceUrl.toString();
    } else {
      return headers.get('Location');
    }
  }

  private async requestOffer() {
    if (this.whepType === WHEPType.Server) {
      this.log(`Requesting offer from: ${this.channelUrl}`);
      const response = await fetch(this.channelUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: ''
      });
      if (response.ok) {
        this.resource = this.getResouceUrlFromHeaders(response.headers);
        this.log('WHEP Resource', this.resource);
        const offer = await response.text();
        this.log('Received offer', offer);
        return offer;
      } else {
        const serverMessage = await response.text();
        throw new Error(serverMessage);
      }
    }
  }

  private async sendAnswer() {
    if (!this.localPeer) {
      this.log('Local RTC peer not initialized');
      return;
    }

    if (this.whepType === WHEPType.Server && this.resource) {
      const answer = this.localPeer.localDescription;
      if (answer) {
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
  }

  private async sendOffer() {
    if (!this.localPeer) {
      this.log('Local RTC peer not initialized');
      return;
    }

    const offer = this.localPeer.localDescription;

    if (this.whepType === WHEPType.Client && offer) {
      this.log(`Sending offer to ${this.channelUrl}`);
      const response = await fetch(this.channelUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (response.ok) {
        this.resource = this.getResouceUrlFromHeaders(response.headers);
        this.log('WHEP Resource', this.resource);
        const answer = await response.text();
        await this.localPeer.setRemoteDescription({
          type: 'answer',
          sdp: answer
        });
      } else if (response.status === 400) {
        this.log(`server does not support client-offer, need to reconnect`);
        this.whepType = WHEPType.Server;
        this.onErrorHandler('reconnectneeded');
      } else if (response.status === 406 && this.audio && !this.opts.audioOnly && !this.opts.videoOnly) {
        this.log(
          `maybe server does not support audio. Let's retry without audio`
        );
        this.audio = false;
        this.video = true;
        this.onErrorHandler('reconnectneeded');
      } else if (response.status === 406 && this.video && !this.opts.audioOnly && !this.opts.videoOnly) {
        this.log(
          `maybe server does not support video. Let's retry without video`
        );
        this.audio = true;
        this.video = false;
        this.onErrorHandler('reconnectneeded');
      } else {
        this.error(`sendAnswer response: ${response.status}`);
        this.onErrorHandler('connectionfailed');
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
