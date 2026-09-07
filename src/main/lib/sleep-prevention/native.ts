import { spawn, type ChildProcess } from "node:child_process"

type Blocker = {
  start(type: "prevent-app-suspension"): number
  stop(id: number): boolean
  isStarted(id: number): boolean
}

export function createSleepAssertionStarter(ports: {
  platform: string
  processId: number
  blocker: Blocker
  spawn?: typeof spawn
}) {
  let caffeinateFailed = false
  return () => {
    if (ports.platform === "darwin" && !caffeinateFailed) {
      let child: ChildProcess | null = null
      try {
        if (!Number.isSafeInteger(ports.processId) || ports.processId <= 0)
          throw new Error("Invalid parent PID")
        child = (ports.spawn ?? spawn)(
          "/usr/bin/caffeinate",
          ["-i", "-w", String(ports.processId)],
          {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
            env: { PATH: "/usr/bin:/bin" },
          },
        )
        let stopping = false
        child.once("error", () => {
          if (!stopping) caffeinateFailed = true
        })
        child.once("exit", () => {
          if (!stopping) caffeinateFailed = true
        })
        if (!child.pid) throw new Error("Helper did not start")
        const owned = child
        return {
          isStarted: () =>
            !stopping && !caffeinateFailed && owned.exitCode === null && owned.signalCode === null,
          stop: () => {
            if (
              owned.exitCode === null &&
              owned.signalCode === null &&
              !owned.killed &&
              !owned.kill()
            ) {
              throw new Error("Could not stop owned sleep helper")
            }
            stopping = true
          },
        }
      } catch {
        caffeinateFailed = true
        if (child?.pid && child.exitCode === null && !child.killed) {
          if (!child.kill()) throw new Error("Could not release failed sleep helper")
        }
      }
    }
    const id = ports.blocker.start("prevent-app-suspension")
    return {
      isStarted: () => ports.blocker.isStarted(id),
      stop: () => {
        if (ports.blocker.isStarted(id) && !ports.blocker.stop(id)) {
          throw new Error("Could not release owned power assertion")
        }
      },
    }
  }
}
