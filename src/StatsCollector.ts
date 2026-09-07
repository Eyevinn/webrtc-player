// Built-in periodic WebRTC playback stats.
//
// Collects RTCStatsReport samples on an interval and derives per-second
// playback quality metrics (bitrate, fps, packet loss, jitter buffer, A/V
// sync, ICE candidate type, ...) from the cumulative counters exposed by
// getStats(). Opt-in: nothing runs until start() is called.

const EMA_ALPHA = 0.3; // smoothing factor for the jitter-buffer delay estimate

export type IceCandidateType = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';

export interface MediaTrackStats {
  bitrate: number; // bits per second, derived from the byte-count delta
  packetsLost: number; // cumulative packets lost
  packetLoss: number; // fraction lost over the interval (0..1)
  jitter: number; // milliseconds
  jitterBufferDelay: number; // EMA-smoothed per-frame/sample delay, milliseconds
}

export interface VideoTrackStats extends MediaTrackStats {
  framesPerSecond: number;
  framesDecoded: number; // cumulative
  frameWidth?: number;
  frameHeight?: number;
  nackCount: number; // cumulative
  pliCount: number; // cumulative
  firCount: number; // cumulative
}

export interface WebRTCStats {
  timestamp: number;
  video?: VideoTrackStats;
  audio?: MediaTrackStats;
  avSyncOffsetMs?: number; // audio jbuf delay - video jbuf delay
  iceCandidateType?: IceCandidateType;
}

// Cumulative counters retained between samples so we can compute deltas.
interface Sample {
  timestamp: number;
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  framesDecoded: number;
  jitterBufferDelay: number; // cumulative seconds
  jitterBufferEmittedCount: number; // cumulative frames/samples
}

const emptySample = (): Sample => ({
  timestamp: 0,
  bytesReceived: 0,
  packetsReceived: 0,
  packetsLost: 0,
  framesDecoded: 0,
  jitterBufferDelay: 0,
  jitterBufferEmittedCount: 0
});

export class StatsCollector {
  private getStats: () => Promise<RTCStatsReport>;
  private intervalMs: number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private onStats: (stats: WebRTCStats) => void;

  private prevVideo: Sample = emptySample();
  private prevAudio: Sample = emptySample();
  private videoJbufEma: number | undefined;
  private audioJbufEma: number | undefined;

  constructor(
    getStats: () => Promise<RTCStatsReport>,
    intervalMs: number,
    onStats: (stats: WebRTCStats) => void
  ) {
    this.getStats = getStats;
    this.intervalMs = intervalMs;
    this.onStats = onStats;
  }

  start() {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(this.sample.bind(this), this.intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.prevVideo = emptySample();
    this.prevAudio = emptySample();
    this.videoJbufEma = undefined;
    this.audioJbufEma = undefined;
  }

  private async sample() {
    let report: RTCStatsReport;
    try {
      report = await this.getStats();
    } catch {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>();
    report.forEach((r) => byId.set(r.id, r));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let videoInbound: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let audioInbound: any;
    let iceCandidateType: IceCandidateType | undefined;

    report.forEach((r) => {
      if (r.type === 'inbound-rtp') {
        if (r.kind === 'video') {
          videoInbound = r;
        } else if (r.kind === 'audio') {
          audioInbound = r;
        }
      } else if (
        r.type === 'candidate-pair' &&
        (r.nominated || r.state === 'succeeded') &&
        r.selected !== false
      ) {
        const local = r.localCandidateId
          ? byId.get(r.localCandidateId)
          : undefined;
        if (local && typeof local.candidateType === 'string') {
          iceCandidateType = this.normalizeCandidateType(local.candidateType);
        }
      }
    });

    const stats: WebRTCStats = {
      timestamp: Date.now(),
      iceCandidateType
    };

    if (videoInbound) {
      const { sample, metrics } = this.deriveVideo(videoInbound);
      this.prevVideo = sample;
      stats.video = metrics;
    }

    if (audioInbound) {
      const { sample, metrics } = this.deriveAudio(audioInbound);
      this.prevAudio = sample;
      stats.audio = metrics;
    }

    if (stats.video && stats.audio) {
      stats.avSyncOffsetMs =
        stats.audio.jitterBufferDelay - stats.video.jitterBufferDelay;
    }

    this.onStats(stats);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deriveVideo(r: any): { sample: Sample; metrics: VideoTrackStats } {
    const sample: Sample = {
      timestamp: r.timestamp ?? Date.now(),
      bytesReceived: r.bytesReceived ?? 0,
      packetsReceived: r.packetsReceived ?? 0,
      packetsLost: r.packetsLost ?? 0,
      framesDecoded: r.framesDecoded ?? 0,
      jitterBufferDelay: r.jitterBufferDelay ?? 0,
      jitterBufferEmittedCount: r.jitterBufferEmittedCount ?? 0
    };
    const prev = this.prevVideo;
    const seconds = this.deltaSeconds(prev.timestamp, sample.timestamp);

    const framesPerSecond =
      seconds > 0
        ? Math.max(0, (sample.framesDecoded - prev.framesDecoded) / seconds)
        : 0;

    this.videoJbufEma = this.updateJbufEma(this.videoJbufEma, prev, sample);

    const metrics: VideoTrackStats = {
      bitrate: this.bitrate(prev, sample, seconds),
      packetsLost: sample.packetsLost,
      packetLoss: this.packetLoss(prev, sample),
      jitter: (r.jitter ?? 0) * 1000,
      jitterBufferDelay: this.videoJbufEma ?? 0,
      framesPerSecond,
      framesDecoded: sample.framesDecoded,
      frameWidth: r.frameWidth,
      frameHeight: r.frameHeight,
      nackCount: r.nackCount ?? 0,
      pliCount: r.pliCount ?? 0,
      firCount: r.firCount ?? 0
    };
    return { sample, metrics };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deriveAudio(r: any): { sample: Sample; metrics: MediaTrackStats } {
    const sample: Sample = {
      timestamp: r.timestamp ?? Date.now(),
      bytesReceived: r.bytesReceived ?? 0,
      packetsReceived: r.packetsReceived ?? 0,
      packetsLost: r.packetsLost ?? 0,
      framesDecoded: 0,
      jitterBufferDelay: r.jitterBufferDelay ?? 0,
      jitterBufferEmittedCount: r.jitterBufferEmittedCount ?? 0
    };
    const prev = this.prevAudio;
    const seconds = this.deltaSeconds(prev.timestamp, sample.timestamp);

    this.audioJbufEma = this.updateJbufEma(this.audioJbufEma, prev, sample);

    const metrics: MediaTrackStats = {
      bitrate: this.bitrate(prev, sample, seconds),
      packetsLost: sample.packetsLost,
      packetLoss: this.packetLoss(prev, sample),
      jitter: (r.jitter ?? 0) * 1000,
      jitterBufferDelay: this.audioJbufEma ?? 0
    };
    return { sample, metrics };
  }

  private deltaSeconds(prevTs: number, ts: number): number {
    if (!prevTs) {
      return 0;
    }
    return (ts - prevTs) / 1000;
  }

  private bitrate(prev: Sample, sample: Sample, seconds: number): number {
    if (seconds <= 0) {
      return 0;
    }
    const deltaBytes = sample.bytesReceived - prev.bytesReceived;
    return Math.max(0, (deltaBytes * 8) / seconds);
  }

  private packetLoss(prev: Sample, sample: Sample): number {
    const deltaLost = sample.packetsLost - prev.packetsLost;
    const deltaReceived = sample.packetsReceived - prev.packetsReceived;
    const deltaExpected = deltaReceived + deltaLost;
    if (deltaExpected <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, deltaLost / deltaExpected));
  }

  // Per-frame/sample jitter buffer delay from the cumulative counters,
  // smoothed with an exponential moving average (alpha = 0.3).
  private updateJbufEma(
    ema: number | undefined,
    prev: Sample,
    sample: Sample
  ): number | undefined {
    const deltaDelay = sample.jitterBufferDelay - prev.jitterBufferDelay;
    const deltaCount =
      sample.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
    if (deltaCount <= 0) {
      return ema;
    }
    const instantaneousMs = (deltaDelay / deltaCount) * 1000;
    if (ema === undefined) {
      return instantaneousMs;
    }
    return EMA_ALPHA * instantaneousMs + (1 - EMA_ALPHA) * ema;
  }

  private normalizeCandidateType(type: string): IceCandidateType {
    switch (type) {
      case 'host':
      case 'srflx':
      case 'prflx':
      case 'relay':
        return type;
      default:
        return 'unknown';
    }
  }
}
