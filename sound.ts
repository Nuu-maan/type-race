let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let muted = false;
let engine: {
  osc: OscillatorNode[];
  pulse: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  road: AudioBufferSourceNode;
  roadFilter: BiquadFilterNode;
  roadGain: GainNode;
  gear: number;
} | null = null;

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

function softClip(amount: number) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

export function startEngine() {
  if (!ctx || engine) return;
  const t = ctx.currentTime;
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClip(2.2);
  shaper.oversample = "2x";
  const throb = ctx.createGain();
  throb.gain.value = 0.75;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 320;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const osc = (
    [
      ["sawtooth", 0.5],
      ["sawtooth", 0.35],
      ["square", 0.3],
    ] as const
  ).map(([type, level]) => {
    const o = ctx!.createOscillator();
    o.type = type;
    const g = ctx!.createGain();
    g.gain.value = level;
    o.connect(g).connect(shaper);
    o.start(t);
    return o;
  });
  osc[1]!.detune.value = 9;
  const pulse = ctx.createOscillator();
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  pulse.connect(depth).connect(throb.gain);
  pulse.start(t);
  shaper.connect(throb).connect(filter).connect(gain).connect(master);

  const road = ctx.createBufferSource();
  road.buffer = noise;
  road.loop = true;
  const roadFilter = ctx.createBiquadFilter();
  roadFilter.type = "bandpass";
  roadFilter.Q.value = 0.6;
  roadFilter.frequency.value = 500;
  const roadGain = ctx.createGain();
  roadGain.gain.value = 0;
  road.connect(roadFilter).connect(roadGain).connect(master);
  road.start(t);
  engine = { osc, pulse, filter, gain, road, roadFilter, roadGain, gear: 0 };
}

const GEARS = 5;

export function updateEngine(speedFraction: number, nitro: boolean) {
  if (!ctx || !engine) return;
  const t = ctx.currentTime;
  const shift = speedFraction * GEARS;
  if (shift > engine.gear + 1 && engine.gear < GEARS - 1) engine.gear++;
  else if (shift < engine.gear - 0.2) engine.gear--;
  const rpm = Math.min(1, Math.max(0, shift - engine.gear)) * 0.7 + 0.3;
  const f = 34 + 70 * rpm + 6 * engine.gear + (nitro ? 14 : 0);
  engine.osc[0]!.frequency.setTargetAtTime(f, t, 0.06);
  engine.osc[1]!.frequency.setTargetAtTime(f, t, 0.06);
  engine.osc[2]!.frequency.setTargetAtTime(f * 0.5, t, 0.06);
  engine.pulse.frequency.setTargetAtTime(f * 0.25, t, 0.06);
  engine.filter.frequency.setTargetAtTime(260 + 900 * rpm + 500 * speedFraction + (nitro ? 400 : 0), t, 0.08);
  engine.gain.gain.setTargetAtTime(0.02 + 0.03 * speedFraction + (nitro ? 0.01 : 0), t, 0.15);
  engine.roadFilter.frequency.setTargetAtTime(400 + 1800 * speedFraction, t, 0.2);
  engine.roadGain.gain.setTargetAtTime(0.003 + 0.022 * speedFraction * speedFraction, t, 0.2);
}

export function stopEngine() {
  if (!ctx || !engine) return;
  const e = engine;
  engine = null;
  const t = ctx.currentTime;
  e.gain.gain.setTargetAtTime(0, t, 0.3);
  e.roadGain.gain.setTargetAtTime(0, t, 0.3);
  for (const o of [...e.osc, e.pulse]) o.stop(t + 1.5);
  e.road.stop(t + 1.5);
}
