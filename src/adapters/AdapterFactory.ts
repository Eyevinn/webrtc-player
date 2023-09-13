import { Adapter } from './Adapter';
import { WHPPAdapter } from './WHPPAdapter';
import { EyevinnAdapter } from './EyevinnAdapter';
import { WHEPAdapter } from './WHEPAdapter';
import { WebRTCPlayerOptions } from '../index';

export interface AdapterFactoryFunction {
  (
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void,
    opts: WebRTCPlayerOptions
  ): Adapter;
}

interface AdapterMap {
  [type: string]: AdapterFactoryFunction;
}

const WHPPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  opts
) => {
  return new WHPPAdapter(peer, channelUrl, onError);
};

const EyevinnAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  opts
) => {
  return new EyevinnAdapter(peer, channelUrl, onError);
};

const WHEPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  opts
) => {
  return new WHEPAdapter(peer, channelUrl, onError, opts);
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
  opts: WebRTCPlayerOptions
): Adapter {
  return adapters[type](peer, channelUrl, onError, opts);
}

export function ListAvailableAdapters(): string[] {
  return Object.keys(adapters);
}
