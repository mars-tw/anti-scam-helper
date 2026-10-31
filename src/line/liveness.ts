/**
 * Detects a LINE connection that died without anyone noticing.
 *
 * After the host is suspended (VM paused, laptop asleep) the long-lived HTTP/2 PUSH stream and the
 * pooled request sockets can be dead while nothing errors: the read just waits forever, requests time
 * out one after another, and the process still looks "online". Two signals reveal it:
 *
 * - Wall-clock jump: a periodic tick sees Date.now() advance much further than the monotonic clock
 *   (which stops while the host is suspended). After such a wake the PUSH stream must show life
 *   within `wakeGraceMs`, or it is treated as dead.
 * - Silence on the PUSH stream: LINE sends ping frames on it every ~30 s, so no inbound data for
 *   `staleMs` means the stream is gone. This is connection-level silence, not "no new messages":
 *   a quiet night still has pings.
 *
 * The monitor only reports; the owner decides how to recover (here: exit and let pm2 restart).
 */
export type StaleReason = "wake" | "silent";

export interface LivenessOptions {
  onStale: (reason: StaleReason, detail: { silentMs: number; jumpMs?: number }) => void;
  /** How often the tick runs. */
  tickMs?: number;
  /** Wall time beyond monotonic time per tick that counts as a suspend. */
  jumpMs?: number;
  /** After a wake, PUSH data must arrive within this time. */
  wakeGraceMs?: number;
  /** No PUSH data for this long means the stream is dead. */
  staleMs?: number;
  /** Silence is not acted on before the monitor has run this long (avoids restart storms when offline). */
  silentCooldownMs?: number;
  wallNow?: () => number;
  monoNow?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export class LivenessMonitor {
  private readonly tickMs: number;
  private readonly jumpMs: number;
  private readonly wakeGraceMs: number;
  private readonly staleMs: number;
  private readonly silentCooldownMs: number;
  private readonly wallNow: () => number;
  private readonly monoNow: () => number;
  private handle: unknown;
  private lastWall = 0;
  private lastMono = 0;
  private startedAt = 0;
  private lastActivity = 0;
  private wokeAt?: number;
  private wokeJump = 0;
  private fired = false;
  /** Number of PUSH data events seen since the last reset (diagnostics only). */
  activityCount = 0;

  constructor(private readonly options: LivenessOptions) {
    this.tickMs = options.tickMs ?? 10_000;
    this.jumpMs = options.jumpMs ?? 30_000;
    this.wakeGraceMs = options.wakeGraceMs ?? 60_000;
    this.staleMs = options.staleMs ?? 180_000;
    this.silentCooldownMs = options.silentCooldownMs ?? 10 * 60_000;
    this.wallNow = options.wallNow ?? Date.now;
    this.monoNow = options.monoNow ?? (() => performance.now());
  }

  get running(): boolean {
    return this.handle !== undefined;
  }

  /** Starts (or restarts) watching; the connection counts as alive right now. */
  start(): void {
    this.stop();
    const wall = this.wallNow();
    this.lastWall = wall;
    this.lastMono = this.monoNow();
    this.startedAt = wall;
    this.lastActivity = wall;
    this.wokeAt = undefined;
    this.fired = false;
    this.activityCount = 0;
    const set = this.options.setInterval ?? ((fn: () => void, ms: number) => { const t = setInterval(fn, ms); t.unref?.(); return t; });
    this.handle = set(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.handle === undefined) return;
    (this.options.clearInterval ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout)))(this.handle);
    this.handle = undefined;
  }

  /** Inbound data on the PUSH stream (ping, push frame, any bytes). */
  touch(): void {
    this.lastActivity = this.wallNow();
    this.activityCount++;
  }

  /** Exposed for tests; normally driven by the interval. */
  tick(): void {
    if (this.fired) return;
    const wall = this.wallNow();
    const mono = this.monoNow();
    const jump = (wall - this.lastWall) - (mono - this.lastMono);
    this.lastWall = wall;
    this.lastMono = mono;
    if (jump > this.jumpMs) {
      this.wokeAt = wall;
      this.wokeJump = jump;
    }
    const silentMs = wall - this.lastActivity;
    if (this.wokeAt !== undefined) {
      if (this.lastActivity >= this.wokeAt) {
        this.wokeAt = undefined;
      } else if (wall - this.wokeAt >= this.wakeGraceMs) {
        return this.fire("wake", { silentMs, jumpMs: this.wokeJump });
      } else {
        // Give the stream its grace period first; the silence of the suspend itself is not evidence.
        return;
      }
    }
    if (silentMs >= this.staleMs && wall - this.startedAt >= this.silentCooldownMs) this.fire("silent", { silentMs });
  }

  private fire(reason: StaleReason, detail: { silentMs: number; jumpMs?: number }): void {
    this.fired = true;
    this.stop();
    this.options.onStale(reason, detail);
  }
}
