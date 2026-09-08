import { Adapter } from './Adapter';
import { WHPPAdapter } from './WHPPAdapter';
import { EyevinnAdapter } from './EyevinnAdapter';
import { WHEPAdapter, WHEPAdapterOptions } from './WHEPAdapter';
import { MediaConstraints } from '../index';

export interface AdapterFactoryFunction {
  (
    peer: RTCPeerConnection,
    channelUrl: URL,
    onError: (error: string) => void,
    mediaConstraints: MediaConstraints,
    authKey: string | undefined,
    options?: WHEPAdapterOptions
  ): Adapter;
}

interface AdapterMap {
  [type: string]: AdapterFactoryFunction;
}

const WHPPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints,
  authKey
) => {
  return new WHPPAdapter(peer, channelUrl, onError);
};

const EyevinnAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints,
  authKey
) => {
  return new EyevinnAdapter(peer, channelUrl, onError);
};

const WHEPAdapterFactory: AdapterFactoryFunction = (
  peer,
  channelUrl,
  onError,
  mediaConstraints,
  authKey,
  options
) => {
  return new WHEPAdapter(
    peer,
    channelUrl,
    onError,
    mediaConstraints,
    authKey,
    options
  );
};

const adapters: AdapterMap = {
  whep: WHEPAdapterFactory,
  'se.eyevinn.whpp': WHPPAdapterFactory,
  'se.eyevinn.webrtc': EyevinnAdapterFactory
};

export function AdapterFactory(
  type: string,
  peer: RTCPeerConnection,
  channelUrl: URL,
  onError: (error: string) => void,
  mediaConstraints: MediaConstraints,
  authKey?: string,
  options?: WHEPAdapterOptions
): Adapter {
  return adapters[type](
    peer,
    channelUrl,
    onError,
    mediaConstraints,
    authKey,
    options
  );
}

export function ListAvailableAdapters(): string[] {
  return Object.keys(adapters);
}
