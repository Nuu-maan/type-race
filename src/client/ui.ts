export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function bindSeg(el: HTMLElement, onChange: (value: string) => void) {
  const inputs = [...el.querySelectorAll<HTMLInputElement>("input")];
  const sync = () => el.style.setProperty("--i", String(Math.max(0, inputs.findIndex((i) => i.checked))));
  for (const input of inputs) {
    input.addEventListener("change", () => {
      sync();
      onChange(input.value);
    });
  }
  sync();
  return (value: string) => {
    for (const input of inputs) input.checked = input.value === value;
    sync();
  };
}

export function setSegEnabled(el: HTMLElement, enabled: boolean) {
  el.classList.toggle("readonly", !enabled);
  for (const input of el.querySelectorAll<HTMLInputElement>("input")) input.disabled = !enabled;
}

export function swapLabel(button: HTMLElement, text: string, revertAfter = 0) {
  const label = button.querySelector<HTMLElement>(".swap");
  if (!label) return;
  const set = (value: string) => {
    label.classList.add("out");
    setTimeout(() => {
      label.textContent = value;
      label.classList.remove("out");
    }, 150);
  };
  set(text);
  if (revertAfter) setTimeout(() => set(label.dataset.label ?? ""), revertAfter);
}

export function countUp(el: HTMLElement, to: number, format: (n: number) => string, ms = 900) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = format(Math.round(to * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function replay(el: HTMLElement, className: string) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
