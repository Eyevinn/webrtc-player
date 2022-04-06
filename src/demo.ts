import { WebRTCPlayer } from ".";

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

  const channels = await getChannels(BROADCASTER_URL);
  if (channels.length > 0) {
    input.value = channels[0].resource;
  }

  document.querySelector<HTMLButtonElement>("#play").addEventListener("click", async () => {
    const channelUrl = input.value;
    const player = new WebRTCPlayer({ video: video, type: "se.eyevinn.webrtc" });
    await player.load(new URL(channelUrl));
    player.unmute();
  });
});