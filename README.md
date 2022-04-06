# webrtc-player

WebRTC player for recvonly streams.

## Usage

```javascript
  import { WebRTCPlayer } from "@eyevinn/webrtc-player";

  const video = document.querySelector("video");
  const player = new WebRTCPlayer({ video: video, type: "se.eyevinn.webrtc" });
  await player.load(new URL(channelUrl));
  player.unmute();
```

## Adapters

As SDP negotiation is WebRTC media server specific this player includes adapters for various types of WebRTC media servers.

### se.eyevinn.webrtc

Compatible with WebRTC media servers in WHIP project.