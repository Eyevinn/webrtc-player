const DEFAULT_CONNECT_TIMEOUT = 2000;

export interface AdapterConnectOptions {
  timeout: number;
}

export interface Adapter {
  enableDebug(): void;
  getPeer(): RTCPeerConnection | undefined;
  resetPeer(newPeer: RTCPeerConnection): void;
  connect(opts?: AdapterConnectOptions): Promise<void>;
}
