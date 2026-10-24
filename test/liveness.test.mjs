import test from "node:test";
import assert from "node:assert/strict";
import { LivenessMonitor } from "../dist/line/liveness.js";

/** A monitor driven by hand: `advance(wall, mono)` moves both clocks, then ticks. */
function harness(options = {}) {
  let wall = 1_000_000;
  let mono = 5_000;
  const fired = [];
  const monitor = new LivenessMonitor({
    tickMs: 10_000, jumpMs: 30_000, wakeGraceMs: 60_000, staleMs: 180_000, silentCooldownMs: 600_000,
    ...options,
    wallNow: () => wall,
    monoNow: () => mono,
    setInterval: () => 1,
    clearInterval: () => {},
    onStale: (reason, detail) => fired.push({ reason, ...detail }),
  });
  monitor.start();
  const advance = (wallMs, monoMs = wallMs) => { wall += wallMs; mono += monoMs; monitor.tick(); };
  return { monitor, fired, advance };
}

test("a quiet but alive connection (pings, no messages) is never flagged, even over hours", () => {
  const { monitor, fired, advance } = harness();
  for (let i = 0; i < 6 * 60 * 8; i++) { // 8 hours of 10 s ticks, a ping every 30 s
    if (i % 3 === 0) monitor.touch();
    advance(10_000);
  }
  assert.deepEqual(fired, []);
});

test("suspend: wall clock jumps past the monotonic clock and no PUSH data follows -> wake", () => {
  const { fired, advance } = harness();
  advance(10_000);
  advance(55 * 60_000, 10_000); // host paused ~55 minutes; monotonic time stood still
  assert.deepEqual(fired, [], "waits for the grace period first");
  for (let i = 0; i < 5; i++) advance(10_000);
  assert.deepEqual(fired, []);
  advance(10_000);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].reason, "wake");
  assert.ok(fired[0].jumpMs >= 55 * 60_000 - 10_000);
  advance(10_000);
  assert.equal(fired.length, 1, "fires once");
});

test("suspend followed by a live PUSH stream is fine", () => {
  const { monitor, fired, advance } = harness();
  advance(2 * 60_000, 10_000);
  advance(10_000);
  monitor.touch();
  for (let i = 0; i < 30; i++) { if (i % 3 === 0) monitor.touch(); advance(10_000); }
  assert.deepEqual(fired, []);
});

test("silence on the PUSH stream for staleMs -> silent, but only after the cooldown", () => {
  const { monitor, fired, advance } = harness();
  monitor.touch();
  for (let i = 0; i < 20; i++) advance(10_000); // 200 s silent, uptime 200 s < 10 min
  assert.deepEqual(fired, []);
  for (let i = 0; i < 40; i++) advance(10_000); // uptime 10 min
  assert.equal(fired.length, 1);
  assert.equal(fired[0].reason, "silent");
});

test("silence after a healthy period is flagged once staleMs passes", () => {
  const { monitor, fired, advance } = harness();
  for (let i = 0; i < 70; i++) { if (i % 3 === 0) monitor.touch(); advance(10_000); }
  monitor.touch();
  assert.deepEqual(fired, []);
  for (let i = 0; i < 17; i++) advance(10_000);
  assert.deepEqual(fired, [], "170 s of silence is still tolerated");
  advance(10_000);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].reason, "silent");
});

test("small NTP corrections are not a wake", () => {
  const { monitor, fired, advance } = harness();
  for (let i = 0; i < 100; i++) { monitor.touch(); advance(10_000 + (i % 2 ? 5_000 : -5_000)); }
  assert.deepEqual(fired, []);
});

test("stop() prevents any further report", () => {
  const { monitor, fired, advance } = harness();
  monitor.stop();
  assert.equal(monitor.running, false);
  advance(60 * 60_000, 0);
  // tick is still callable by hand in tests, but a stopped monitor is not scheduled; restart resets state
  monitor.start();
  advance(10_000);
  assert.deepEqual(fired, []);
});

test("provider: PUSH bytes from linejs keep the monitor alive; silence reports onStale once; teardown stops it", async () => {
  const { EvexLineProvider } = await import("../dist/line/provider.js");
  let wall = 1_000_000;
  let mono = 0;
  let tick;
  const stale = [];
  const storage = { async flush() {}, async get() {}, async set() {} };
  const provider = new EvexLineProvider(storage, "DESKTOPWIN", {
    onMessage() {}, onRead() {}, onStatus() {}, onError() {}, onUnsend() {}, onChecked() {}, onChatsChanged() {}, onReactions() {},
    onStale: (reason, detail) => stale.push({ reason, ...detail }),
  }, undefined, undefined, {
    staleMs: 180_000, silentCooldownMs: 0, wallNow: () => wall, monoNow: () => mono,
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = undefined; },
  });
  const base = provider.createBase();
  provider.startLiveness();
  const step = (ms) => { wall += ms; mono += ms; tick?.(); };
  for (let i = 0; i < 60; i++) { if (i % 3 === 0) base.log("[LEGY/PUSH] readByte", new Uint8Array([0])); step(10_000); }
  base.log("[LEGY/PUSH] send status frame. flag:0, pi:30"); // outbound/other logs are not proof of life
  assert.deepEqual(stale, []);
  for (let i = 0; i < 18; i++) step(10_000);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].reason, "silent");
  provider.startLiveness();
  await provider.close();
  assert.equal(tick, undefined, "close() stops the monitor");
});
