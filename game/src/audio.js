// Sound, synthesized with WebAudio — no audio files, nothing fetched. Short
// noise bursts and filtered blips stand in for gunfire, reloads, hits and the
// bomb. Everything is fire-and-forget and safe before the first user gesture:
// the context is created lazily and resumed on the play click, and every
// function no-ops while it is suspended (as it is during screenshot runs).

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 0.5;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function ready() {
  return ctx && ctx.state === 'running';
}

function noise(dur, filterFreq, gain, type = 'lowpass') {
  if (!ready()) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(now, Math.random() * 0.2);
  src.stop(now + dur);
}

function blip(freq, dur, gain, type = 'square', slideTo = null) {
  if (!ready()) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + dur);
}

export function shot(kind, own) {
  const g = own ? 0.5 : 0.22;
  if (kind === 'boar') { noise(0.28, 700, g); blip(120, 0.12, g * 0.6, 'triangle', 50); }
  else if (kind === 'longbow') { noise(0.32, 1100, g); blip(90, 0.2, g * 0.7, 'triangle', 40); }
  else if (kind === 'kestrel') { noise(0.1, 1600, g * 0.8); }
  else { noise(0.14, 1300, g); }
}

export function empty(own) { if (own) blip(1900, 0.04, 0.12); }
export function swing() { noise(0.08, 3000, 0.1, 'bandpass'); }
export function reload(own) { if (!own) return; blip(500, 0.05, 0.15); setTimeout(() => blip(750, 0.05, 0.15), 220); }
export function hit(killed) { blip(killed ? 1500 : 1100, 0.07, 0.2, 'sine'); if (killed) setTimeout(() => blip(1900, 0.09, 0.2, 'sine'), 60); }
export function hurt() { blip(160, 0.12, 0.25, 'sawtooth', 90); }
export function throwIt() { noise(0.07, 2400, 0.06, 'bandpass'); }
export function explosion() { noise(0.7, 300, 0.8); blip(70, 0.5, 0.7, 'triangle', 30); }
export function flash() { noise(0.2, 5000, 0.4, 'highpass'); }
export function smokePop() { noise(0.3, 900, 0.15); }
export function beep(final) { blip(final ? 1560 : 1040, final ? 0.3 : 0.08, 0.22, 'sine'); }
export function plantDone() { blip(880, 0.09, 0.2, 'sine'); setTimeout(() => blip(1320, 0.12, 0.2, 'sine'), 110); }
export function roundWin() { blip(660, 0.12, 0.18, 'triangle'); setTimeout(() => blip(990, 0.18, 0.18, 'triangle'), 120); }
export function roundLose() { blip(392, 0.14, 0.18, 'triangle'); setTimeout(() => blip(311, 0.22, 0.18, 'triangle'), 130); }
export function buy() { blip(1240, 0.05, 0.12, 'sine'); }
export function denied() { blip(220, 0.09, 0.15, 'square'); }
