import { Adapter } from './Adapter';
import { WHPPAdapter } from './WHPPAdapter';
import { EyevinnAdapter } from './EyevinnAdapter';
import { WHEPAdapter } from './WHEPAdapter';

export interface AdapterFactoryFunction {
  (
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void
  ): Adapter;
}

const WHPPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError
) => {
  return new WHPPAdapter(peer, channelUrl, onError);
};

const EyevinnAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError
) => {
  return new EyevinnAdapter(peer, channelUrl, onError);
};

const WHEPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError
) => {
  return new WHEPAdapter(peer, channelUrl, onError);
};

const adapters = {
  'se.eyevinn.whpp': WHPPAdapterFactory,
  'se.eyevinn.webrtc': EyevinnAdapterFactory,
  whep: WHEPAdapterFactory
};

export function AdapterFactory(
  type: string,
  peer: RTCPeerConnection,
  channelUrl: URL,
  onError: (error: string) => void
): Adapter {
  return adapters[type](peer, channelUrl, onError);
}

export function ListAvailableAdapters(): string[] {
  return Object.keys(adapters);
}
