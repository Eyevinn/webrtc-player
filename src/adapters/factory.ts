import { BaseAdapter } from "./base";
import { EyevinnAdapter } from "./eyevinn";

export interface AdapterFactoryFunction {
  (peer: RTCPeerConnection, channelUrl: URL): BaseAdapter;
}

const EyevinnAdapterFactory: AdapterFactoryFunction = (peer, channelUrl) => {
  return new EyevinnAdapter(peer, channelUrl);
}

export function AdapterFactory(type: string, peer: RTCPeerConnection, channelUrl: URL) {
  const adapters = {
    "se.eyevinn.webrtc": EyevinnAdapterFactory,
  };
  
  return adapters[type](peer, channelUrl);
}