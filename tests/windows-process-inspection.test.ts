import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { drainWindowsOwnedProcessIds } from "../scripts/lib/windows-processes.mjs"

describe("Windows Flapstack process ownership", () => {
  it("rechecks ownership after killing the root before acting on a child pid", async () => {
    let rootAlive = true
    let childOwned = true
    let childPidReused = false
    let now = 0
    const killed: number[] = []

    const result = await drainWindowsOwnedProcessIds({
      findOwned: () => [...(rootAlive ? [11] : []), ...(childOwned ? [12] : [])],
      kill: (pid: number) => {
        killed.push(pid)
        if (pid === 11) {
          rootAlive = false
          childOwned = false
          childPidReused = true
        }
        return `${pid}:0:`
      },
      wait: async () => {
        now += 100
      },
      now: () => now,
      timeoutMs: 1_000,
    })

    expect(childPidReused).toBe(true)
    expect(killed).toEqual([11])
    expect(result).toMatchObject({ stable: true, remaining: [] })
  })
})
