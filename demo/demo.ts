import { WebRTCPlayer, ListAvailableAdapters } from '../src/index';

interface PacketsLost {
  [type: string]: number;
}

const BROADCASTER_URL =
  process.env.BROADCASTER_URL ||
  'https://broadcaster.lab.sto.eyevinn.technology:8443/broadcaster';

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
  pill.className = 'status-pill' + (state !== 'idle' ? ' ' + state : '');
  label.textContent =
    state === 'idle' ? 'Idle' : state === 'connecting' ? 'Connecting…' : 'Live';
}

function setPlaceholderVisible(visible: boolean) {
  const placeholder =
    document.querySelector<HTMLDivElement>('#video-placeholder');
  if (placeholder) {
    placeholder.style.display = visible ? 'flex' : 'none';
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(
  message: string,
  duration = 2500,
  action?: { label: string; onClick: () => void }
): void {
  const toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.innerHTML = '';

  if (action) {
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'toast-close-btn';
    closeBtn.onclick = () => toast.classList.remove('visible', 'has-action');

    const content = document.createElement('div');
    content.className = 'toast-content';

    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;
    content.appendChild(msg);

    const buttonsRow = document.createElement('div');
    buttonsRow.className = 'toast-buttons';
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.className = 'toast-action-btn';
    btn.onclick = () => {
      toast.classList.remove('visible', 'has-action');
      action.onClick();
    };
    buttonsRow.appendChild(btn);
    content.appendChild(buttonsRow);

    toast.appendChild(closeBtn);
    toast.appendChild(content);
    toast.classList.add('has-action', 'visible');
  } else {
    const msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(msg);
    toast.classList.add('visible');
    toastTimer = setTimeout(() => {
      toast.classList.remove('visible', 'has-action');
    }, duration);
  }
}

function getChannelLabel(url: string): string {
  try {
    const u = new URL(url);
    // match /channel/<id> anywhere in the path
    const m = u.pathname.match(/\/channel\/([^/]+)/i);
    if (m) return `Channel: ${m[1]}`;
    // fallback: last path segment
    return u.pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
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

  // Pre-fill channelUrl from URL param if present
  const channelUrlParam = searchParams.get('channelUrl');
  if (channelUrlParam && input) {
    input.value = channelUrlParam;
  }

  if (!input.value && process.env.CHANNEL_URL_PLACEHOLDER) {
    input.value = process.env.CHANNEL_URL_PLACEHOLDER;
  }

  const adapterLabels: Record<string, string> = {
    'se.eyevinn.whpp': 'WHPP',
    'se.eyevinn.webrtc': 'Eyevinn',
    whep: 'WHEP'
  };

  ListAvailableAdapters().forEach((adapterType) => {
    const btn = document.createElement('button');
    btn.textContent = adapterLabels[adapterType] ?? adapterType;
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
      // Pre-create srcObject and call play() NOW while we're inside the user gesture.
      // The browser's autoplay policy ties play() permission to the gesture context;
      // by the time tracks arrive asynchronously, the gesture is long gone.
      if (!video.srcObject) {
        video.srcObject = new MediaStream();
      }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      video.play().catch(() => {});

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

    const channelDisplay =
      document.querySelector<HTMLElement>('#channel-display');
    const channelEmpty = document.querySelector<HTMLElement>('#channel-empty');
    const channelCard = document.querySelector<HTMLElement>(
      '#active-channel-card'
    );
    const channelLabel = document.querySelector<HTMLElement>(
      '#active-channel-label'
    );
    const channelDot = document.querySelector<HTMLElement>(
      '#active-channel-dot'
    );

    function showChannelCard(state: 'loading' | 'live') {
      if (channelLabel) channelLabel.textContent = getChannelLabel(channelUrl);
      if (channelCard)
        channelCard.classList.toggle('loading', state === 'loading');
      if (channelDot)
        channelDot.className =
          state === 'loading' ? 'connecting-dot' : 'live-dot';
      if (channelDisplay) channelDisplay.style.display = 'block';
      if (channelEmpty) channelEmpty.style.display = 'none';
    }

    function hideChannelCard() {
      if (channelDisplay) channelDisplay.style.display = 'none';
      if (channelEmpty) channelEmpty.style.display = 'flex';
    }

    function onConnectFailed(message: string) {
      setStatus('idle');
      setPlaceholderVisible(true);
      if (video) video.removeAttribute('controls');
      if (video) video.style.visibility = '';
      const audioPlaceholderEl =
        document.querySelector<HTMLDivElement>('#audio-placeholder');
      if (audioPlaceholderEl) audioPlaceholderEl.style.display = 'none';
      const muteBtnEl =
        document.querySelector<HTMLButtonElement>('#audio-mute-btn');
      if (muteBtnEl) {
        muteBtnEl.classList.remove('muted');
        muteBtnEl.title = 'Mute';
        muteBtnEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
      }
      hideChannelCard();
      showToast(message, 6000);
    }

    function enterAudioOnlyMode() {
      const audioPlaceholder =
        document.querySelector<HTMLDivElement>('#audio-placeholder');
      if (video) video.style.visibility = 'hidden';
      if (audioPlaceholder) audioPlaceholder.style.display = 'flex';

      let isMuted = false;
      const muteBtn =
        document.querySelector<HTMLButtonElement>('#audio-mute-btn');
      if (muteBtn) {
        muteBtn.onclick = () => {
          isMuted = !isMuted;
          if (isMuted) {
            player.mute();
            muteBtn.title = 'Unmute';
            muteBtn.classList.add('muted');
            muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17 19.73l2 2L20.27 20 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
          } else {
            player.unmute();
            muteBtn.title = 'Mute';
            muteBtn.classList.remove('muted');
            muteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
          }
        };
      }
    }

    // player.load() always resolves immediately — connection results come via events.
    player.on('peer-connection-connected', () => {
      setStatus('live');
      showChannelCard('live');

      // Auto-detect audio-only: check after metadata loads whether video has dimensions
      if (video) {
        const checkAudioOnly = () => {
          const stream = video.srcObject as MediaStream | null;
          const hasVideoTrack = stream
            ? stream.getVideoTracks().length > 0
            : false;
          if (!hasVideoTrack || video.videoWidth === 0) {
            enterAudioOnlyMode();
          }
        };
        if (video.readyState >= 1) {
          checkAudioOnly();
        } else {
          video.addEventListener('loadedmetadata', checkAudioOnly, {
            once: true
          });
          // Fallback: if loadedmetadata never fires (audio-only streams may not), check after 2s
          setTimeout(() => {
            if (video.style.visibility !== 'hidden') checkAudioOnly();
          }, 2000);
        }
      }
    });

    player.on('no-media', () => {
      showToast('No media received — stream may be offline', 5000);
    });

    player.on('connect-error', () => {
      onConnectFailed('Failed to connect — check the URL and try again');
    });

    player.on('initial-connection-failed', () => {
      onConnectFailed('Failed to connect — check the URL and try again');
    });

    player.on('peer-connection-failed', () => {
      setStatus('idle');
      setPlaceholderVisible(true);
      if (video) video.style.visibility = '';
      const audioPlaceholderEl =
        document.querySelector<HTMLDivElement>('#audio-placeholder');
      if (audioPlaceholderEl) audioPlaceholderEl.style.display = 'none';
      hideChannelCard();
      showToast('Stream disconnected', 8000, {
        label: 'Reconnect',
        onClick: () => {
          setStatus('connecting');
          setPlaceholderVisible(false);
          if (video) video.setAttribute('controls', '');
          showChannelCard('loading');
          player.load(new URL(channelUrl));
        }
      });
    });

    setStatus('connecting');
    setPlaceholderVisible(false);
    if (video) video.setAttribute('controls', '');
    showChannelCard('loading');
    player.load(new URL(channelUrl));
  });

  const stopButton = document.querySelector<HTMLButtonElement>('#stop');
  stopButton?.addEventListener('click', async () => {
    await player?.unload();
    if (video) video.srcObject = null;
    setStatus('idle');
    setPlaceholderVisible(true);
    video?.removeAttribute('controls');
    if (video) video.style.visibility = '';
    const audioPlaceholderEl =
      document.querySelector<HTMLDivElement>('#audio-placeholder');
    if (audioPlaceholderEl) audioPlaceholderEl.style.display = 'none';
    const muteBtnEl =
      document.querySelector<HTMLButtonElement>('#audio-mute-btn');
    if (muteBtnEl) {
      muteBtnEl.classList.remove('muted');
      muteBtnEl.title = 'Mute';
      muteBtnEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
    }
    const stopChannelDisplay =
      document.querySelector<HTMLElement>('#channel-display');
    const stopChannelEmpty =
      document.querySelector<HTMLElement>('#channel-empty');
    if (stopChannelDisplay) stopChannelDisplay.style.display = 'none';
    if (stopChannelEmpty) stopChannelEmpty.style.display = 'flex';
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
