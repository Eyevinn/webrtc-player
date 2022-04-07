import { BaseAdapter } from "./base";
import { EyevinnAdapter } from "./eyevinn";

export interface AdapterFactoryFunction {
  (peer: RTCPeerConnection, channelUrl: URL): BaseAdapter;
}

const EyevinnAdapterFactory: AdapterFactoryFunction = (peer, channelUrl) => {
  return new EyevinnAdapter(peer, channelUrl);
}

const adapters = {
  "se.eyevinn.webrtc": EyevinnAdapterFactory,
};

export function AdapterFactory(type: string, peer: RTCPeerConnection, channelUrl: URL) {  
  return adapters[type](peer, channelUrl);
}

export function ListAvailableAdapters() {
  return Object.keys(adapters);
}