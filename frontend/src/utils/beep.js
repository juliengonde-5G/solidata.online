let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, durationMs, type = 'sine', volume = 0.3 }) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(c.destination);
  const start = c.currentTime;
  osc.start(start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + durationMs / 1000);
  osc.stop(start + durationMs / 1000);
}

export function beepSuccess() {
  tone({ freq: 880, durationMs: 90, type: 'sine', volume: 0.35 });
}

export function beepError() {
  tone({ freq: 220, durationMs: 350, type: 'square', volume: 0.4 });
}

export function beepAlreadyOut() {
  tone({ freq: 220, durationMs: 200, type: 'square', volume: 0.4 });
  setTimeout(() => tone({ freq: 220, durationMs: 200, type: 'square', volume: 0.4 }), 230);
}

export function unlockAudio() {
  getCtx();
}
