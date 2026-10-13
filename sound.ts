let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let muted = false;
let engine: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;

try {
  muted = localStorage.getItem("muted") === "1";
} catch {}

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem("muted", value ? "1" : "0");
  } catch {}
  if (ctx) master.gain.setTargetAtTime(value ? 0 : 0.8, ctx.currentTime, 0.05);
}

function envelope(peak: number, attack: number, decay: number, at = ctx!.currentTime) {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(master);
  return g;
}

function tone(type: OscillatorType, freq: number, peak: number, decay: number, at = 0) {
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(envelope(peak, 0.005, decay, start));
  osc.start(start);
  osc.stop(start + decay + 0.05);
}

function burst(freq: number, q: number, peak: number, decay: number, sweepTo?: number) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + decay);
  src.connect(filter).connect(envelope(peak, 0.01, decay));
  src.start(ctx.currentTime, Math.random() * 0.5);
  src.stop(ctx.currentTime + decay + 0.05);
}

export function keySound(ok: boolean) {
  if (ok) burst(2600 + Math.random() * 900, 1.2, 0.05, 0.025);
  else tone("sine", 130, 0.08, 0.09);
}

export function countSound(go: boolean) {
  tone("sine", go ? 1046 : 523, 0.12, go ? 0.35 : 0.14);
}

export function nitroSound() {
  burst(350, 0.9, 0.12, 0.6, 2400);
}

export function finishSound(won: boolean) {
  const notes = won ? [523, 659, 784, 1046] : [392, 330, 262];
  notes.forEach((f, i) => tone("triangle", f, 0.1, won ? 0.5 : 0.6, i * (won ? 0.09 : 0.14)));
}

export function startEngine() {
  if (!ctx || engine) return;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 300;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const osc = (["sawtooth", "square"] as const).map((type) => {
    const o = ctx!.createOscillator();
    o.type = type;
    o.connect(filter);
    o.start();
    return o;
  });
  filter.connect(gain).connect(master);
  engine = { osc, filter, gain };
}

export function updateEngine(speedFraction: number, nitro: boolean) {
  if (!ctx || !engine) return;
  const t = ctx.currentTime;
  const f = 42 + 120 * speedFraction + (nitro ? 18 : 0);
  engine.osc[0]!.frequency.setTargetAtTime(f, t, 0.08);
  engine.osc[1]!.frequency.setTargetAtTime(f * 0.5, t, 0.08);
  engine.filter.frequency.setTargetAtTime(260 + 1400 * speedFraction, t, 0.1);
  engine.gain.gain.setTargetAtTime(0.018 + 0.03 * speedFraction, t, 0.15);
}

export function stopEngine() {
  if (!ctx || !engine) return;
  const e = engine;
  engine = null;
  e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  for (const o of e.osc) o.stop(ctx.currentTime + 1.5);
}
