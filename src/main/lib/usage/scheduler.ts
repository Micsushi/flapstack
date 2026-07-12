// Stage 2 Track B - U2: usage poll scheduler.
//
// Wraps a UsageEngine with a cadence timer. Used by the daemon (U3) and can also
// drive an in-app periodic refresh. Default cadence 5 minutes (S2.0),
// configurable via settings. Ticks never overlap: a slow poll defers the next
// tick rather than stacking.

import type { UsageEngine } from "./engine"
import { getUsageSettings } from "./settings"

export interface SchedulerOptions {
  /** Cadence loader override (tests). Defaults to settings.cadenceSeconds. */
  getCadenceSeconds?: () => number
  onTickError?: (err: unknown) => void
  onTickComplete?: () => void
}

export class UsageScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private stopped = false

  constructor(
    private readonly engine: UsageEngine,
    private readonly options: SchedulerOptions = {},
  ) {}

  private cadenceMs(): number {
    const seconds = this.options.getCadenceSeconds?.() ?? getUsageSettings().cadenceSeconds
    return Math.max(30, seconds) * 1000
  }

  start(): void {
    if (this.timer || this.running) return
    this.stopped = false
    this.scheduleNext(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tick(), delayMs)
  }

  /** Run one poll pass, then schedule the next. Public so callers can force a tick. */
  async tick(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      await this.engine.runOnce("poll")
      this.options.onTickComplete?.()
    } catch (err) {
      this.options.onTickError?.(err)
    } finally {
      this.running = false
      this.scheduleNext(this.cadenceMs())
    }
  }
}
