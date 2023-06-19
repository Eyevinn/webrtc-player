import { Adapter, AdapterConnectOptions } from './Adapter';
import { WHPPClient } from '@eyevinn/whpp-client';

export class WHPPAdapter implements Adapter {
  private client: WHPPClient | undefined = undefined;
  private localPeer: RTCPeerConnection | undefined = undefined;
  private channelUrl: URL;
  private debug = false;

  constructor(
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void
  ) {
    this.channelUrl = channelUrl;
    this.resetPeer(peer);
  }

  enableDebug() {
    this.debug = true;
  }

  resetPeer(newPeer: RTCPeerConnection) {
    this.localPeer = newPeer;
  }

  getPeer(): RTCPeerConnection | undefined {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    if (this.localPeer) {
      this.client = new WHPPClient(this.localPeer, this.channelUrl, {
        debug: this.debug
      });
      await this.client.connect();
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
