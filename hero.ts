import { PAINTS } from "./progress";
import { createScene } from "./scene";
import { $ } from "./ui";

const SPEED = 36;
const LOOP = 600;

const canvas = $<HTMLCanvasElement>("hero-canvas");
let scene: ReturnType<typeof createScene> | null = null;
let frame = 0;
let visible = true;
let active = false;
let distance = 0;
let time = 0;

new IntersectionObserver(([entry]) => {
  visible = entry?.isIntersecting ?? true;
  if (visible && active) run();
}).observe(canvas);

function run() {
  cancelAnimationFrame(frame);
  if (!scene) {
    try {
      scene = createScene(canvas);
      new ResizeObserver(() => scene?.resize()).observe(canvas);
    } catch {
      return;
    }
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    distance = (distance + SPEED * dt) % LOOP;
    const lead = 150 + distance;
    scene!.render(
      dt,
      [
        { pos: lead + 5 + Math.sin(time * 0.4) * 3, speed: SPEED + 2, slip: false, nitro: false, name: "", color: PAINTS[1].color, body: "muscle" },
        { pos: lead, speed: SPEED, slip: false, nitro: Math.sin(time * 0.35) > 0.8, name: "", color: PAINTS[0].color, body: "gt" },
      ],
      1,
    );
    if (!still && visible && active) frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}

export function startHero() {
  active = true;
  run();
}

export function stopHero() {
  active = false;
  cancelAnimationFrame(frame);
}
