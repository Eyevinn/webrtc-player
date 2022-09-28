import { WebRTCPlayer, ListAvailableAdapters } from "../src/index";

const BROADCASTER_URL = process.env.BROADCASTER_URL || "https://broadcaster.lab.sto.eyevinn.technology:8443/broadcaster";
const WHEP_URL = process.env.WHEP_URL || "https://wrtc-edge.lab.sto.eyevinn.technology:8443/whep/channel/sthlm"

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
  const inputPrerollUrl = document.querySelector<HTMLInputElement>("#prerollUrl");

  const searchParams = new URL(window.location.href).searchParams;
  const type = searchParams.get("type") || "se.eyevinn.whpp";

  if (type === "se.eyevinn.whpp" || type === "se.eyevinn.webrtc") {
    const channels = await getChannels(BROADCASTER_URL);
    if (channels.length > 0) {
      input.value = channels[0].resource;
    }
    inputContainer.style.display = "block";
  } else {
    if (type === "whep") {
      input.value = WHEP_URL;
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

  let player;

  document.querySelector<HTMLButtonElement>("#play").addEventListener("click", async () => {
    const channelUrl = input.value;
    const vmapUrl = document.querySelector<HTMLInputElement>("#preroll").checked ? 
      inputPrerollUrl.value : undefined;
    player = new WebRTCPlayer({ 
      video: video, 
      type: type,
      iceServers: iceServers, 
      debug: true,
      vmapUrl: vmapUrl,
    });

    await player.load(new URL(channelUrl));
  });
});
