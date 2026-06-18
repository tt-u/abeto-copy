// Plays one of the scene's music tracks and exposes a beat `pulse()` (bass energy) so the
// visuals can lock to whichever track is playing. Switching tracks crossfades; the shared
// analyser always reads the audible track, so the beat-sync follows the chosen song.
// Audio can only start from a user gesture — call `play()` from a click.

export const TRACKS = ["/audio/theme-1.mp3", "/audio/theme-2.mp3"];

interface Track {
  audio: HTMLAudioElement;
  gain: GainNode;
}

export class Ambient {
  private ctx: AudioContext | null = null;
  private tracks: Track[] = [];
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array | null = null;
  private lp: BiquadFilterNode | null = null;
  private gain: GainNode | null = null; // master on/off fade
  private _pulse = 0;
  private mood = 0.6;
  current = 0;
  running = false;

  private build(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 20000;
    this.lp = lp;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);

    const master = ctx.createGain();
    master.gain.value = 0;
    this.gain = master;

    // each track → its own gain (for crossfading) → shared lowpass → analyser → master
    lp.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);

    this.tracks = TRACKS.map((url) => {
      const audio = new Audio(url);
      audio.loop = true;
      audio.crossOrigin = "anonymous";
      const src = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(lp);
      return { audio, gain };
    });
  }

  /** Start (or switch to) a track, fading it in. Crossfades from the previous one. */
  play(index: number): void {
    this.build();
    const ctx = this.ctx!;
    void ctx.resume();
    const i = Math.max(0, Math.min(this.tracks.length - 1, index));
    const wasRunning = this.running;
    const prev = this.current;
    this.current = i;
    this.running = true;
    const now = ctx.currentTime;

    // master fade-in
    this.gain!.gain.cancelScheduledValues(now);
    this.gain!.gain.linearRampToValueAtTime(0.9, now + (wasRunning ? 0.05 : 1.0));

    // bring the chosen track up
    const t = this.tracks[i];
    void t.audio.play();
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.linearRampToValueAtTime(1, now + (wasRunning ? 0.5 : 0.05));

    // crossfade the previous one out, then pause it
    if (wasRunning && prev !== i) {
      const p = this.tracks[prev];
      p.gain.gain.cancelScheduledValues(now);
      p.gain.gain.linearRampToValueAtTime(0, now + 0.5);
      window.setTimeout(() => {
        if (this.current !== prev || !this.running) p.audio.pause();
      }, 650);
    }
  }

  stop(): void {
    if (!this.ctx) return;
    this.running = false;
    const now = this.ctx.currentTime;
    this.gain!.gain.cancelScheduledValues(now);
    this.gain!.gain.linearRampToValueAtTime(0, now + 0.6);
    window.setTimeout(() => {
      if (!this.running) this.tracks.forEach((t) => t.audio.pause());
    }, 700);
  }

  // 0 = cold/muffled (winter), 1 = bright (summer)
  setMood(x: number): void {
    this.mood = Math.min(1, Math.max(0, x));
    if (this.ctx && this.lp) {
      this.lp.frequency.setTargetAtTime(1400 + this.mood * 17000, this.ctx.currentTime, 1.2);
    }
  }

  // Bass energy 0..1 of the currently-playing track, smoothed BOTH ways so it rises and
  // falls gently with the music (a snappy peak-follow made the flower twitch).
  pulse(): number {
    if (!this.running || !this.analyser || !this.freq) {
      this._pulse *= 0.92;
      return this._pulse;
    }
    this.analyser.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>);
    let sum = 0;
    const n = 6; // lowest bins ≈ the kick / bass
    for (let i = 1; i <= n; i++) sum += this.freq[i];
    const e = sum / (n * 255);
    const k = e > this._pulse ? 0.14 : 0.05; // ease up a little quicker than it eases down
    this._pulse += (e - this._pulse) * k;
    return this._pulse;
  }
}
