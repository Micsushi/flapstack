import type { SleepPreventionMode, SleepPreventionStatus } from "../../../shared/sleep-prevention"

type Assertion = { isStarted(): boolean; stop(): void }

/** Owns only assertions it created. Never reads persisted process IDs as ownership. */
export class SleepPreventionController {
  private assertion: Assertion | null = null
  private mode: SleepPreventionMode
  private disposed = false
  private error: string | null = null
  private agentWork = false
  private terminals = 0

  constructor(
    private readonly ports: {
      mode: SleepPreventionMode
      persist(mode: SleepPreventionMode): void
      readWork(): { agentWork: boolean; terminals: number }
      start(): Assertion
    },
  ) {
    this.mode = ports.mode
  }

  setMode(mode: SleepPreventionMode): SleepPreventionStatus {
    if (this.disposed) throw new Error("Sleep prevention is shutting down")
    if (!["off", "automatic", "on"].includes(mode)) throw new Error("Invalid sleep prevention mode")
    this.ports.persist(mode)
    this.mode = mode
    return this.refresh()
  }

  refresh(): SleepPreventionStatus {
    this.error = null
    try {
      const work = this.ports.readWork()
      if (!Number.isSafeInteger(work.terminals) || work.terminals < 0)
        throw new Error("Invalid work count")
      this.agentWork = work.agentWork
      this.terminals = work.terminals
    } catch {
      this.agentWork = false
      this.terminals = 0
      this.error = "Cannot verify active work; automatic sleep prevention is paused."
    }
    const wanted =
      !this.disposed &&
      (this.mode === "on" ||
        (this.mode === "automatic" && !this.error && (this.agentWork || this.terminals > 0)))
    try {
      if (this.assertion && !this.assertion.isStarted()) {
        this.assertion.stop()
        this.assertion = null
      }
      if (!wanted && this.assertion) {
        this.assertion.stop()
        this.assertion = null
      }
      if (wanted && !this.assertion) this.assertion = this.ports.start()
      if (wanted && !this.assertion?.isStarted()) throw new Error("Assertion not active")
    } catch {
      this.error = wanted
        ? "Could not keep the system awake. Check power settings or retry."
        : "Could not release sleep prevention. Retry Off or quit Flapstack."
    }
    return this.status()
  }

  status(): SleepPreventionStatus {
    let active = false
    try {
      active = this.assertion?.isStarted() ?? false
    } catch {
      /* Never claim an unverified assertion. */
    }
    return {
      mode: this.mode,
      active,
      agentWork: this.agentWork,
      terminals: this.terminals,
      error: this.error,
    }
  }

  dispose(): void {
    this.disposed = true
    this.refresh()
  }
}
