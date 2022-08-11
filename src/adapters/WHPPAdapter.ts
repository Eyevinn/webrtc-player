import { Adapter, AdapterConnectOptions } from './Adapter'
import { WHPPClient } from "@eyevinn/whpp-client";

export class WHPPAdapter implements Adapter {
  private client: WHPPClient;
  private localPeer: RTCPeerConnection;
  private channelUrl: URL;
  private debug: boolean;

  constructor(peer: RTCPeerConnection, channelUrl: URL) {
    this.localPeer = peer;
    this.channelUrl = channelUrl;
  }

  enableDebug() {
    this.debug = true;
  }

  getPeer(): RTCPeerConnection {
    return this.localPeer;
  }

  async connect(opts?: AdapterConnectOptions) {
    this.client = new WHPPClient(this.localPeer, this.channelUrl, { debug: this.debug });
    await this.client.connect();
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
