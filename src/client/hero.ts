import { PAINTS } from "../shared/progress";
import { $ } from "./ui";

const SPEED = 36;
const LOOP = 600;

const canvas = $<HTMLCanvasElement>("hero-canvas");
type HeroCar = { pos: number; body: string; speed: number; slip: boolean; nitro: boolean; name: string; color: string };
type HeroScene = { render: (dt: number, cars: HeroCar[], meIndex: number) => void; resize: () => void; dispose: () => void };

let scene: HeroScene | null = null;
let loading: Promise<void> | null = null;
let frame = 0;
let loadTimer = 0;
let visible = true;
let active = false;
let distance = 0;
let time = 0;
let resizeObserver: ResizeObserver | null = null;

const intersectionObserver = new IntersectionObserver(([entry]) => {
  visible = entry?.isIntersecting ?? true;
  if (visible && active) run();
  else cancelAnimationFrame(frame);
});
intersectionObserver.observe(canvas);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelAnimationFrame(frame);
  else if (visible && active) run();
});

function run() {
  cancelAnimationFrame(frame);
  if (!active || !visible || document.hidden || matchMedia("(max-width: 560px)").matches) return;
  if (!scene) {
    if (!loading) {
      loading = import("./scene")
        .then(({ createScene }) => {
          if (!active || !visible || document.hidden || matchMedia("(max-width: 560px)").matches) return;
          scene = createScene(canvas);
          resizeObserver = new ResizeObserver(() => scene?.resize());
          resizeObserver.observe(canvas);
          run();
        })
        .catch(() => {})
        .finally(() => {
          loading = null;
        });
    }
    return;
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
    if (!still && visible && active && !document.hidden) frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}

export function startHero() {
  active = true;
  clearTimeout(loadTimer);
  if (matchMedia("(max-width: 560px)").matches) return;
  loadTimer = window.setTimeout(run, 150);
}

export function stopHero() {
  active = false;
  clearTimeout(loadTimer);
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  resizeObserver = null;
  scene?.dispose();
  scene = null;
}
