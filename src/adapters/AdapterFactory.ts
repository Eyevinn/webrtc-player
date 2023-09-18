import { Adapter } from './Adapter';
import { WHPPAdapter } from './WHPPAdapter';
import { EyevinnAdapter } from './EyevinnAdapter';
import { WHEPAdapter } from './WHEPAdapter';
import { MediaConstraints } from '../index';

export interface AdapterFactoryFunction {
  (
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void,
    mediaConstraints: MediaConstraints
  ): Adapter;
}

interface AdapterMap {
  [type: string]: AdapterFactoryFunction;
}

const WHPPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints
) => {
  return new WHPPAdapter(peer, channelUrl, onError);
};

const EyevinnAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints
) => {
  return new EyevinnAdapter(peer, channelUrl, onError);
};

const WHEPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints
) => {
  return new WHEPAdapter(peer, channelUrl, onError, mediaConstraints);
};

const adapters: AdapterMap = {
  'se.eyevinn.whpp': WHPPAdapterFactory,
  'se.eyevinn.webrtc': EyevinnAdapterFactory,
  whep: WHEPAdapterFactory
};

export function AdapterFactory(
  type: string,
  peer: RTCPeerConnection,
  channelUrl: URL,
  onError: (error: string) => void,
  mediaConstraints: MediaConstraints
): Adapter {
  return adapters[type](peer, channelUrl, onError, mediaConstraints);
}

export function ListAvailableAdapters(): string[] {
  return Object.keys(adapters);
}
