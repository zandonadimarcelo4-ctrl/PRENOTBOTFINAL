export function playBeep(times = 3): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1200;
      gain.gain.value = 0.22;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const startAt = ctx.currentTime + i * 0.45;
      osc.start(startAt);
      osc.stop(startAt + 0.32);
    }
  } catch {
    // ignore audio errors if blocked by browser autoplay policy
  }
}
