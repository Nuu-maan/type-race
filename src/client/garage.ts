import { BODIES, PAINTS, paintById, type Car } from "../shared/progress";
import { createGarage } from "./scene";
import { $, el, replay } from "./ui";

type Item = { id: string; label: string; level: number };

let preview: ReturnType<typeof createGarage> | null = null;
let level = 1;
let car: Car = { paint: "cobalt", body: "gt" };
let onPick: (car: Car) => void = () => {};

function getPreview() {
  if (!preview) {
    try {
      preview = createGarage($<HTMLCanvasElement>("garage-canvas"));
    } catch {
      return null;
    }
  }
  return preview;
}

function hint(text: string) {
  const node = $("garage-hint");
  node.textContent = text;
  replay(node, "fresh");
}

function picker(container: HTMLElement, name: string, items: readonly Item[], selected: string, kind: "paint" | "body") {
  container.replaceChildren(
    ...items.map((item) => {
      const locked = item.level > level;
      const label = el("label", `pick${locked ? " locked" : ""}`);
      label.title = locked ? `${item.label} · unlocks at level ${item.level}` : item.label;
      const input = el("input");
      input.type = "radio";
      input.name = name;
      input.value = item.id;
      input.checked = item.id === selected;
      input.setAttribute("aria-label", locked ? `${item.label}, unlocks at level ${item.level}` : item.label);
      input.setAttribute("aria-disabled", String(locked));
      label.append(input);
      if (kind === "paint") {
        const chip = el("span");
        chip.style.background = paintById(item.id)!.color;
        label.append(chip);
      } else {
        label.append(item.label);
      }
      if (locked) label.append(el("span", "lock", String(item.level)));
      input.addEventListener("change", () => {
        if (locked) {
          input.checked = false;
          container.querySelector<HTMLInputElement>(`input[value="${kind === "paint" ? car.paint : car.body}"]`)!.checked = true;
          replay(label, "shake");
          hint(`${item.label} unlocks at level ${item.level}. Race to earn XP.`);
          return;
        }
        car = kind === "paint" ? { ...car, paint: item.id as Car["paint"] } : { ...car, body: item.id as Car["body"] };
        hint(`${paintById(car.paint)!.label} ${BODIES.find((b) => b.id === car.body)!.label}`);
        getPreview()?.setCar(paintById(car.paint)!.color, car.body);
        onPick(car);
      });
      return label;
    }),
  );
}

export function renderGarage(nextLevel: number, nextCar: Car, pick: (car: Car) => void) {
  level = nextLevel;
  car = nextCar;
  onPick = pick;
  picker($("paints"), "paint", PAINTS, car.paint, "paint");
  picker($("bodies"), "body", BODIES, car.body, "body");
  const next = [...PAINTS, ...BODIES].filter((i) => i.level > level).sort((a, b) => a.level - b.level)[0];
  $("garage-hint").textContent = next ? `Next unlock: ${next.label} at level ${next.level}` : "Everything unlocked.";
  getPreview()?.setCar(paintById(car.paint)!.color, car.body);
}

export function startGarage() {
  getPreview()?.start();
}

export function stopGarage() {
  preview?.dispose();
  preview = null;
}
