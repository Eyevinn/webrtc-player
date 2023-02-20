import { WebRTCPlayer, ListAvailableAdapters } from '../src/index';

const BROADCASTER_URL =
  process.env.BROADCASTER_URL ||
  'https://broadcaster.lab.sto.eyevinn.technology:8443/broadcaster';
const WHEP_URL =
  process.env.WHEP_URL ||
  'https://wrtc-edge.lab.sto.eyevinn.technology:8443/whep/channel/sthlm';

async function getChannels(broadcasterUrl) {
  const response = await fetch(broadcasterUrl + '/channel');
  if (response.ok) {
    const channels = await response.json();
    return channels;
  }
  return [];
}

let clientTimeMsElement;

function pad(v: number, n: number) {
  for (var r = v.toString(); r.length < n; r = 0 + r);
  return r;
}

function updateClientClock() {
  const now = new Date();
  const [h, m, s, ms] = [
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  ];
  const ts = `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
  clientTimeMsElement.innerHTML = ts;
}

window.addEventListener('DOMContentLoaded', async () => {
  const input = document.querySelector<HTMLInputElement>('#channelUrl');
  const video = document.querySelector('video');
  const inputContainer = document.querySelector<HTMLDivElement>('#input');
  const adapterContainer = document.querySelector<HTMLDivElement>('#adapters');
  const inputPrerollUrl =
    document.querySelector<HTMLInputElement>('#prerollUrl');

  const searchParams = new URL(window.location.href).searchParams;
  const type = searchParams.get('type') || 'se.eyevinn.whpp';

  if (type === 'se.eyevinn.whpp' || type === 'se.eyevinn.webrtc') {
    const channels = await getChannels(BROADCASTER_URL);
    if (channels.length > 0) {
      input.value = channels[0].resource;
    }
    inputContainer.style.display = 'block';
  } else {
    if (type === 'whep') {
      input.value = WHEP_URL;
    }
    inputContainer.style.display = 'block';
  }

  ListAvailableAdapters().forEach((adapterType) => {
    const btn = document.createElement('button');
    btn.textContent = adapterType;
    btn.onclick = () => {
      const url = new URL(window.location.href);
      url.searchParams.set('type', adapterType);
      window.open(url, '_self');
    };
    adapterContainer.appendChild(btn);
  });

  let iceServers: RTCIceServer[];

  if (process.env.ICE_SERVERS) {
    iceServers = [];
    process.env.ICE_SERVERS.split(',').forEach((server) => {
      // turn:<username>:<password>@turn.eyevinn.technology:3478
      const m = server.match(/^turn:(\S+):(\S+)@(\S+):(\d+)/);
      if (m) {
        const [_, username, credential, host, port] = m;
        iceServers.push({
          urls: 'turn:' + host + ':' + port,
          username: username,
          credential: credential
        });
      }
    });
  }

  let player;

  document
    .querySelector<HTMLButtonElement>('#play')
    .addEventListener('click', async () => {
      const channelUrl = input.value;
      const vmapUrl = document.querySelector<HTMLInputElement>('#preroll')
        .checked
        ? inputPrerollUrl.value
        : undefined;
      player = new WebRTCPlayer({
        video: video,
        type: type,
        iceServers: iceServers,
        debug: true,
        vmapUrl: vmapUrl,
        statsTypeFilter: '^candidate-*|^inbound-rtp'
      });

      let packetsLost = { video: 0, audio: 0 };

      player.on('stats:candidate-pair', (report) => {
        if (report.nominated) {
          document.querySelector<HTMLSpanElement>(
            '#stats-current-rtt'
          ).innerHTML = `RTT: ${report.currentRoundTripTime * 1000}ms`;
          if (report.availableIncomingBitrate) {
            document.querySelector<HTMLSpanElement>(
              '#stats-incoming-bitrate'
            ).innerHTML = `Bitrate: ${Math.round(
              report.availableIncomingBitrate / 1000
            )}kbps`;
          }
        }
      });
      player.on('stats:inbound-rtp', (report) => {
        if (report.kind === 'video' || report.kind === 'audio') {
          packetsLost[report.kind] = report.packetsLost;
          document.querySelector<HTMLSpanElement>(
            '#stats-packetloss'
          ).innerHTML = `Packets Lost: A=${packetsLost.audio},V=${packetsLost.video}`;
        }
      });

      await player.load(new URL(channelUrl));
    });

  clientTimeMsElement = document.querySelector<HTMLSpanElement>('#localTimeMs');
  window.setInterval(updateClientClock, 1);
});
