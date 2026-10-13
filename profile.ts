import { levelProgress, type Car } from "./progress";
import { $, replay } from "./ui";

export type Profile = { id: string; name: string; xp: number; level: number; car: Car; races: number; wins: number; bestWpm: number };

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loadId() {
  try {
    const saved = localStorage.getItem("pid");
    if (saved) return saved;
    const id = uuid();
    localStorage.setItem("pid", id);
    return id;
  } catch {
    return uuid();
  }
}

export const playerId = loadId();

export async function fetchProfile(): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profile?id=${playerId}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

let shownLevel = 0;

export function renderMe(name: string, xp: number) {
  const { level, into, needed } = levelProgress(xp);
  $("me-chip").hidden = false;
  $("me-name").textContent = name;
  const badge = $("me-level");
  badge.textContent = String(level);
  if (shownLevel && level > shownLevel) replay(badge, "pulse");
  shownLevel = level;
  $("me-xp").style.setProperty("--p", String(into / needed));
}
