import { readdirSync, readFileSync } from "node:fs"

interface ProcessIdentity {
  pid: number
  parent: number
  session: number
  start: string
  state: string
}

function readProcess(pid: number): ProcessIdentity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/)
    if (!/^\d+$/.test(fields[19] ?? "")) throw new Error("Invalid Linux process identity.")
    return {
      pid,
      state: fields[0]!,
      parent: Number(fields[1]),
      session: Number(fields[3]),
      start: fields[19]!,
    }
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return
    throw error
  }
}

function running(identity: ProcessIdentity | undefined): identity is ProcessIdentity {
  return !!identity && identity.state !== "Z" && identity.state !== "X"
}

/** Linux PTYs own a new session. Retain identities before the shell can orphan its children. */
export class LinuxProcessOwnership {
  private identities = new Map<number, ProcessIdentity>()
  private initialError: unknown

  constructor(private readonly rootPid: number) {
    try {
      const root = readProcess(rootPid)
      // forkpty can return before its child calls setsid; own that child, not its inherited session.
      if (!root || (root.session !== rootPid && root.parent !== process.pid))
        throw new Error("Linux PTY session ownership is unavailable.")
      this.identities.set(rootPid, root)
    } catch (error) {
      this.initialError = error
    }
  }

  capture(): number[] {
    if (this.initialError) throw this.initialError
    const snapshot = new Map<number, ProcessIdentity>()
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue
      const entry = readProcess(Number(name))
      if (running(entry)) snapshot.set(entry.pid, entry)
    }
    const owned = new Map<number, ProcessIdentity>()
    const sessions = new Set<number>()
    for (const identity of this.identities.values()) {
      const current = snapshot.get(identity.pid)
      if (current?.start !== identity.start) continue
      owned.set(current.pid, current)
      // A descendant may leave our session, but cannot confer ownership of another session.
      if (current.session === this.rootPid || current.session === current.pid)
        sessions.add(current.session)
    }
    let changed = true
    while (changed) {
      changed = false
      for (const current of snapshot.values()) {
        if (owned.has(current.pid)) continue
        const parent = owned.get(current.parent)
        if (
          !sessions.has(current.session) &&
          (!parent || BigInt(current.start) < BigInt(parent.start))
        )
          continue
        // Recheck the ancestry/session anchor before retaining a newly observed identity.
        const anchor =
          parent ?? [...owned.values()].find((entry) => entry.session === current.session)
        if (!anchor || readProcess(anchor.pid)?.start !== anchor.start) continue
        if (readProcess(current.pid)?.start !== current.start) continue
        owned.set(current.pid, current)
        this.identities.set(current.pid, current)
        if (current.session === current.pid) sessions.add(current.session)
        changed = true
      }
    }
    if (
      [...snapshot.values()].some(
        (entry) => entry.session === this.rootPid && !owned.has(entry.pid),
      )
    ) {
      throw new Error("Linux terminal descendants could not be attributed safely. Retry cleanup.")
    }
    return [...this.identities.keys()]
  }

  survivors(): number[] {
    return [...this.identities.values()]
      .filter((identity) => {
        const current = readProcess(identity.pid)
        return running(current) && current.start === identity.start
      })
      .map((identity) => identity.pid)
  }

  async stop(): Promise<boolean> {
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      const signalled = new Set<number>()
      for (let attempt = 0; attempt < (signal === "SIGTERM" ? 80 : 20); attempt++) {
        this.capture()
        for (const identity of [...this.identities.values()].reverse()) {
          if (signalled.has(identity.pid)) continue
          const current = readProcess(identity.pid)
          if (!running(current) || current.start !== identity.start) continue
          try {
            // Never signal a process group or an unchecked/reused PID.
            process.kill(identity.pid, signal)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
          }
          signalled.add(identity.pid)
        }
        if (this.survivors().length === 0) return true
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    this.capture()
    return this.survivors().length === 0
  }
}
