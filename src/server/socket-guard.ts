export const MAX_INPUT_MESSAGE_BYTES = 64;
export const INPUT_WINDOW_MS = 1000;
export const MAX_INPUTS_PER_WINDOW = 80;
export const MAX_CONTROLS_PER_WINDOW = 10;

export type InputMessage = { t: "key"; c: string } | { t: "back" } | { t: "wordBack" } | { t: "start" };

export type InputRate = {
  startedAt: number;
  accepted: number;
};

function textOf(raw: string | ArrayBufferView) {
  if (typeof raw === "string") return new TextEncoder().encode(raw).byteLength <= MAX_INPUT_MESSAGE_BYTES ? raw : null;
  if (raw.byteLength > MAX_INPUT_MESSAGE_BYTES) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  } catch {
    return null;
  }
}

function hasOnly(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseInputMessage(raw: string | ArrayBufferView): InputMessage | null {
  const text = textOf(raw);
  if (text === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const message = value as Record<string, unknown>;
  if (message.t === "key") {
    if (!hasOnly(message, ["t", "c"]) || typeof message.c !== "string") return null;
    return [...message.c].length === 1 && !/[\p{C}\p{M}]/u.test(message.c) ? { t: "key", c: message.c } : null;
  }
  if ((message.t === "back" || message.t === "wordBack" || message.t === "start") && hasOnly(message, ["t"])) return message as InputMessage;
  return null;
}

export function inputRate(now = Date.now()): InputRate {
  return { startedAt: now, accepted: 0 };
}

function accept(rate: InputRate, limit: number, now: number) {
  if (now < rate.startedAt || now - rate.startedAt >= INPUT_WINDOW_MS) {
    rate.startedAt = now;
    rate.accepted = 0;
  }
  if (rate.accepted >= limit) return false;
  rate.accepted++;
  return true;
}

export function acceptInput(rate: InputRate, now = Date.now()) {
  return accept(rate, MAX_INPUTS_PER_WINDOW, now);
}

export function acceptControl(rate: InputRate, now = Date.now()) {
  return accept(rate, MAX_CONTROLS_PER_WINDOW, now);
}
