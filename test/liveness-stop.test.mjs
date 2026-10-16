// Process-level simulation: a test-only child process watches a TCP "PUSH" stream fed by a pinger
// process. Both are frozen with SIGSTOP; only the watcher is resumed, so its stream is dead after
// the "wake". The watcher must notice and exit(1) on its own, the way the LINE service does.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const pinger = `
const net = require("node:net");
const server = net.createServer((socket) => { const t = setInterval(() => socket.write("p"), 100); socket.on("close", () => clearInterval(t)); socket.on("error", () => {}); });
server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
`;
const watcher = (port) => `
import net from "node:net";
import { LivenessMonitor } from ${JSON.stringify(new URL("../dist/line/liveness.js", import.meta.url).href)};
const monitor = new LivenessMonitor({ tickMs: 100, jumpMs: 1000, wakeGraceMs: 1000, staleMs: 800, silentCooldownMs: 0,
  onStale: (reason) => { process.stdout.write("STALE " + reason + "\\n"); process.exit(1); } });
const socket = net.connect(${port}, "127.0.0.1", () => { monitor.start(); process.stdout.write("READY\\n"); });
socket.on("data", () => monitor.touch());
socket.on("error", () => {});
setInterval(() => {}, 1000);
`;

const lines = (child) => {
  const out = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => out.push(...d.split("\n").filter(Boolean)));
  return out;
};
const waitFor = async (out, pattern, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (out.some((l) => pattern.test(l))) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test("SIGSTOP/SIGCONT with a dead stream: the watcher exits 1 by itself; a healthy pause does not", async (t) => {
  const ping = spawn(process.execPath, ["-e", pinger], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { try { process.kill(ping.pid, "SIGCONT"); } catch {} ping.kill("SIGKILL"); });
  const [portLine] = await once(ping.stdout, "data");
  const port = Number(String(portLine).trim());

  // 1) Pause only the watcher; the pinger keeps the stream alive -> no restart.
  const healthy = spawn(process.execPath, ["--input-type=module", "-e", watcher(port)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => healthy.kill("SIGKILL"));
  const hOut = lines(healthy);
  assert.ok(await waitFor(hOut, /READY/, 5000));
  process.kill(healthy.pid, "SIGSTOP");
  await new Promise((r) => setTimeout(r, 600));
  process.kill(healthy.pid, "SIGCONT");
  assert.equal(await waitFor(hOut, /STALE/, 2500), false, "live stream after a short pause must not be flagged");
  healthy.kill("SIGKILL");

  // 2) Pause both; resume only the watcher -> its stream is silent -> exit(1).
  const dead = spawn(process.execPath, ["--input-type=module", "-e", watcher(port)], { stdio: ["ignore", "pipe", "inherit"] });
  const dOut = lines(dead);
  assert.ok(await waitFor(dOut, /READY/, 5000));
  process.kill(ping.pid, "SIGSTOP");
  process.kill(dead.pid, "SIGSTOP");
  await new Promise((r) => setTimeout(r, 1500));
  process.kill(dead.pid, "SIGCONT");
  const [code] = await once(dead, "exit");
  assert.equal(code, 1);
  assert.ok(dOut.some((l) => /^STALE (silent|wake)$/.test(l)));
});
