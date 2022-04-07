import { WebRTCPlayer, ListAvailableAdapters } from "../src/index";

const BROADCASTER_URL = process.env.BROADCASTER_URL || "https://broadcaster-wrtc.prod.eyevinn.technology/broadcaster";

async function getChannels(broadcasterUrl) {
  const response = await fetch(broadcasterUrl + "/channel");
  if (response.ok) {
    const channels = await response.json();
    return channels;
  }
  return [];
}

window.addEventListener("DOMContentLoaded", async () => {
  const input = document.querySelector<HTMLInputElement>("#channelUrl");
  const video = document.querySelector("video");
  const inputContainer = document.querySelector<HTMLDivElement>("#input");
  const adapterContainer = document.querySelector<HTMLDivElement>("#adapters");

  const searchParams = new URL(window.location.href).searchParams;
  const type = searchParams.get("type") || "se.eyevinn.webrtc";

  if (type === "se.eyevinn.webrtc") {
    const channels = await getChannels(BROADCASTER_URL);
    if (channels.length > 0) {
      input.value = channels[0].resource;
    }
    inputContainer.style.display = "block";
  }

  ListAvailableAdapters().forEach(adapterType => {
    const btn = document.createElement("button");
    btn.textContent = adapterType;
    btn.onclick = () => {
      const url = new URL(window.location.href);
      url.searchParams.set("type", adapterType);
      window.open(url, "_self");
    };
    adapterContainer.appendChild(btn);
  });

  let iceServers: RTCIceServer[];

  if (process.env.ICE_SERVERS) {
    iceServers = [];
    process.env.ICE_SERVERS.split(",").forEach(server => {
      // turn:<username>:<password>@turn.eyevinn.technology:3478
      const m = server.match(/^turn:(\S+):(\S+)@(\S+):(\d+)/);
      if (m) {
        const [ _, username, credential, host, port ] = m;
        iceServers.push({ urls: "turn:" + host + ":" + port, username: username, credential: credential });
      }
    });
  }

  document.querySelector<HTMLButtonElement>("#play").addEventListener("click", async () => {
    const channelUrl = input.value;
    const player = new WebRTCPlayer({ video: video, type: type, iceServers: iceServers });
    await player.load(new URL(channelUrl));
  });
});