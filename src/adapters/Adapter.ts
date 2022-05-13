const DEFAULT_CONNECT_TIMEOUT = 2000;

export interface AdapterConnectOptions {
  timeout: number;
}

export interface Adapter{
    setupDataChannels(labels: string[]): RTCDataChannel[];
    enableDebug();
    getPeer() : RTCPeerConnection;
    connect(opts?: AdapterConnectOptions);
}
