import { Adapter } from "./Adapter";
import { WHPPAdapter } from "./WHPPAdapter";
import { EyevinnAdapter } from "./EyevinnAdapter";
import { WHEPAdapter } from "./WHEPAdapter";

export interface AdapterFactoryFunction {
  (peer: RTCPeerConnection, channelUrl: URL): Adapter;
}

const WHPPAdapterFactory: AdapterFactoryFunction = (peer, channelUrl) => {
  return new WHPPAdapter(peer, channelUrl);
}

const EyevinnAdapterFactory: AdapterFactoryFunction = (peer, channelUrl) => {
  return new EyevinnAdapter(peer, channelUrl);
}

const WHEPAdapterFactory: AdapterFactoryFunction = (peer, channelUrl) => {
  return new WHEPAdapter(peer, channelUrl);
}

const adapters = {
  "se.eyevinn.whpp": WHPPAdapterFactory,
  "se.eyevinn.webrtc": EyevinnAdapterFactory,
  "whep": WHEPAdapterFactory,
};

export function AdapterFactory(type: string, peer: RTCPeerConnection, channelUrl: URL): Adapter {  
  return adapters[type](peer, channelUrl);
}

export function ListAvailableAdapters(): string[] {
  return Object.keys(adapters);
}
