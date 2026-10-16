import { expect, test } from "bun:test";
import {
  acceptInput,
  acceptControl,
  inputRate,
  MAX_INPUT_MESSAGE_BYTES,
  MAX_INPUTS_PER_WINDOW,
  MAX_CONTROLS_PER_WINDOW,
  parseInputMessage,
} from "./socket-guard";

test("accepts the supported input messages", () => {
  expect(parseInputMessage('{"t":"key","c":"a"}')).toEqual({ t: "key", c: "a" });
  expect(parseInputMessage(new TextEncoder().encode('{"t":"key","c":"!"}'))).toEqual({ t: "key", c: "!" });
  expect(parseInputMessage('{"t":"key","c":" "}')).toEqual({ t: "key", c: " " });
  expect(parseInputMessage('{"t":"back"}')).toEqual({ t: "back" });
  expect(parseInputMessage('{"t":"wordBack"}')).toEqual({ t: "wordBack" });
  expect(parseInputMessage('{"t":"start"}')).toEqual({ t: "start" });
});

test("rejects malformed, oversized, or unexpected messages", () => {
  expect(parseInputMessage("{")).toBeNull();
  expect(parseInputMessage("null")).toBeNull();
  expect(parseInputMessage('{"t":"key","c":"ab"}')).toBeNull();
  expect(parseInputMessage('{"t":"key","c":"\\n"}')).toBeNull();
  expect(parseInputMessage('{"t":"key","c":"a","extra":true}')).toBeNull();
  expect(parseInputMessage('{"t":"back","w":true}')).toBeNull();
  expect(parseInputMessage('{"t":"difficulty"}')).toBeNull();
  expect(parseInputMessage(" ".repeat(MAX_INPUT_MESSAGE_BYTES + 1))).toBeNull();
  expect(parseInputMessage(new Uint8Array([123, 34, 116, 34, 58, 34, 255, 34, 125]))).toBeNull();
});

test("limits each input window and resets at its boundary", () => {
  const rate = inputRate(1000);
  for (let i = 0; i < MAX_INPUTS_PER_WINDOW; i++) expect(acceptInput(rate, 1000)).toBe(true);
  expect(acceptInput(rate, 1999)).toBe(false);
  expect(acceptInput(rate, 2000)).toBe(true);
  expect(rate).toEqual({ startedAt: 2000, accepted: 1 });
});

test("limits lower-frequency control messages separately", () => {
  const rate = inputRate(1000);
  for (let i = 0; i < MAX_CONTROLS_PER_WINDOW; i++) expect(acceptControl(rate, 1000)).toBe(true);
  expect(acceptControl(rate, 1500)).toBe(false);
  expect(acceptControl(rate, 2000)).toBe(true);
});
