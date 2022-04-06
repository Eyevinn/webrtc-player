import { EyevinnAdapter } from "./eyevinn";

export function AdapterFactory(type: string, peer: RTCPeerConnection, channelUrl: URL) {
  switch (type) {
    case "se.eyevinn.webrtc":
      return new EyevinnAdapter(peer, channelUrl);
    default:
      throw new Error("Invalid adapter type");
  }
}