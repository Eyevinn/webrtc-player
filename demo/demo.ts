import { WebRTCPlayer, ListAvailableAdapters } from '../src/index';

interface PacketsLost {
  [type: string]: number;
}

const BROADCASTER_URL =
  process.env.BROADCASTER_URL ||
  'https://broadcaster.lab.sto.eyevinn.technology:8443/broadcaster';
const WHEP_URL =
  process.env.WHEP_URL ||
  'https://srtwhep.lab.sto.eyevinn.technology:8443/channel';

async function getChannels(broadcasterUrl: string) {
  const response = await fetch(broadcasterUrl + '/channel');
  if (response.ok) {
    const channels = await response.json();
    return channels;
  }
  return [];
}

let clientTimeMsElement: HTMLSpanElement | null;

function pad(v: number, n: number) {
  let r;
  for (r = v.toString(); r.length < n; r = '0' + r);
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
  if (clientTimeMsElement) {
    clientTimeMsElement.innerHTML = ts;
  }
}

function setStatus(state: 'idle' | 'connecting' | 'live') {
  const pill = document.querySelector<HTMLDivElement>('#status-pill');
  const label = document.querySelector<HTMLSpanElement>('#status-label');
  if (!pill || !label) return;
  pill.className = `status-pill ${state}`;
  label.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

function setPlaceholderVisible(visible: boolean) {
  const placeholder =
    document.querySelector<HTMLDivElement>('#video-placeholder');
  if (placeholder) {
    placeholder.style.display = visible ? 'flex' : 'none';
  }
}

function showToast(message: string, duration = 2500): void {
  const container = document.querySelector<HTMLDivElement>('#toast');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });
  });
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function getShareUrl(): string {
  const url = new URL(window.location.href);
  const channelUrl =
    document.querySelector<HTMLInputElement>('#channelUrl')?.value;
  if (channelUrl) {
    url.searchParams.set('channelUrl', channelUrl);
  }
  return url.toString();
}

window.addEventListener('DOMContentLoaded', async () => {
  const input = document.querySelector<HTMLInputElement>('#channelUrl');
  const video = document.querySelector('video');
  const adapterContainer = document.querySelector<HTMLDivElement>('#adapters');
  const inputPrerollUrl =
    document.querySelector<HTMLInputElement>('#prerollUrl');
  const prerollCheckbox = document.querySelector<HTMLInputElement>('#preroll');
  const prerollUrlField =
    document.querySelector<HTMLDivElement>('#prerollUrlField');

  if (!input || !adapterContainer || !inputPrerollUrl) {
    return;
  }

  const searchParams = new URL(window.location.href).searchParams;
  const type = searchParams.get('type') || 'whep';

  if (type === 'se.eyevinn.whpp' || type === 'se.eyevinn.webrtc') {
    const channels = await getChannels(BROADCASTER_URL);
    if (channels.length > 0) {
      input.value = channels[0].resource;
    }
  } else {
    if (type === 'whep') {
      input.value = WHEP_URL;
    }
  }

  // Pre-fill channelUrl from URL param if present
  const channelUrlParam = searchParams.get('channelUrl');
  if (channelUrlParam && input) {
    input.value = channelUrlParam;
  }

  ListAvailableAdapters().forEach((adapterType) => {
    const btn = document.createElement('button');
    btn.textContent = adapterType;
    if (adapterType === type) btn.classList.add('active');
    btn.onclick = () => {
      const url = new URL(window.location.href);
      url.searchParams.set('type', adapterType);
      window.open(url, '_self');
    };
    adapterContainer.appendChild(btn);
  });

  prerollCheckbox?.addEventListener('change', () => {
    if (prerollUrlField) {
      prerollUrlField.style.display = prerollCheckbox.checked
        ? 'block'
        : 'none';
    }
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

  let player: WebRTCPlayer;

  const playButton = document.querySelector<HTMLButtonElement>('#play');
  playButton?.addEventListener('click', async () => {
    const channelUrl = input.value;
    const vmapUrl =
      prerollCheckbox && prerollCheckbox.checked
        ? inputPrerollUrl.value
        : undefined;

    if (video) {
      player = new WebRTCPlayer({
        video: video,
        type: type,
        iceServers: iceServers,
        debug: true,
        vmapUrl: vmapUrl,
        statsTypeFilter: '^candidate-*|^inbound-rtp'
      });
    }

    const packetsLost: PacketsLost = { video: 0, audio: 0 };

    player.on('stats:candidate-pair', (report) => {
      const rttEl =
        document.querySelector<HTMLDivElement>('#stats-current-rtt');
      const bitrateEl = document.querySelector<HTMLDivElement>(
        '#stats-incoming-bitrate'
      );
      if (report.nominated && rttEl) {
        rttEl.textContent = `RTT: ${report.currentRoundTripTime * 1000}ms`;
        rttEl.classList.add('has-value');
        if (report.availableIncomingBitrate && bitrateEl) {
          bitrateEl.textContent = `Bitrate: ${Math.round(
            report.availableIncomingBitrate / 1000
          )}kbps`;
          bitrateEl.classList.add('has-value');
        }
      }
    });

    player.on('stats:inbound-rtp', (report) => {
      if (report.kind === 'video' || report.kind === 'audio') {
        const lossEl =
          document.querySelector<HTMLDivElement>('#stats-packetloss');
        packetsLost[report.kind] = report.packetsLost;
        if (lossEl) {
          lossEl.textContent = `Packets Lost: A=${packetsLost.audio}, V=${packetsLost.video}`;
          lossEl.classList.add('has-value');
        }
      }
    });

    setStatus('connecting');
    setPlaceholderVisible(false);
    if (video) video.setAttribute('controls', '');
    try {
      await player.load(new URL(channelUrl));
      setStatus('live');
    } catch {
      setStatus('idle');
      setPlaceholderVisible(true);
    }
  });

  const stopButton = document.querySelector<HTMLButtonElement>('#stop');
  stopButton?.addEventListener('click', async () => {
    await player?.unload();
    setStatus('idle');
    setPlaceholderVisible(true);
    video?.removeAttribute('controls');
    const statSelectors: Array<[string, string]> = [
      ['#stats-current-rtt', 'RTT: \u2014'],
      ['#stats-incoming-bitrate', 'Bitrate: \u2014'],
      ['#stats-packetloss', 'Packets Lost: \u2014']
    ];
    statSelectors.forEach(([sel, defaultText]) => {
      const el = document.querySelector<HTMLDivElement>(sel);
      if (el) {
        el.classList.remove('has-value');
        el.textContent = defaultText;
      }
    });
  });

  const shareBtn = document.querySelector<HTMLButtonElement>('#share-btn');
  shareBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(getShareUrl()).then(
      () => showToast('Share URL copied to clipboard'),
      () => showToast('Could not access clipboard')
    );
  });

  clientTimeMsElement = document.querySelector<HTMLSpanElement>('#localTimeMs');
  window.setInterval(updateClientClock, 1);
});
