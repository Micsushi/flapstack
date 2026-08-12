import { promisify } from "node:util"
import { beforeEach, describe, expect, it, vi } from "vitest"

const execFileCalls: string[][] = []
let execFileResponder: (file: string, args: string[]) => { stdout: string } = () => ({ stdout: "" })

// promisify() honours the custom symbol, so the mock can return a promise
// directly instead of emulating the callback contract.
const execFile = Object.assign(
  (_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    callback(new Error("not used"))
  },
  {
    [promisify.custom]: async (file: string, args: string[] = []) => {
      execFileCalls.push([file, ...args])
      const { stdout } = execFileResponder(file, args)
      return { stdout, stderr: "" }
    },
  },
)

vi.mock("node:child_process", () => ({ execFile, default: { execFile } }))
vi.mock("pidtree", () => ({ default: async (pid: number) => [pid] }))

const { getListeningPortsForPids, getProcessName, __resetWmicAvailabilityForTests } =
  await import("../src/main/lib/terminal/port-scanner")

describe("port scanner caches", () => {
  beforeEach(() => {
    execFileCalls.length = 0
    execFileResponder = () => ({ stdout: "" })
  })

  it("serves a repeated pid set from cache", async () => {
    await getListeningPortsForPids([4242, 4243])
    const afterFirst = execFileCalls.length
    await getListeningPortsForPids([4243, 4242])

    expect(afterFirst).toBeGreaterThan(0)
    expect(execFileCalls).toHaveLength(afterFirst)
  })

  it("does not keep entries for every pid set it has ever seen", async () => {
    const probe = [999_001]
    await getListeningPortsForPids(probe)

    // Push well past the cache bound with distinct keys.
    for (let i = 0; i < 200; i++) {
      await getListeningPortsForPids([500_000 + i])
    }

    const before = execFileCalls.length
    await getListeningPortsForPids(probe)

    // The original entry must have been evicted rather than retained forever.
    expect(execFileCalls.length).toBeGreaterThan(before)
  })

  it("does not reorder the caller's pid array", async () => {
    const pids = [30, 10, 20]
    await getListeningPortsForPids(pids)

    expect(pids).toEqual([30, 10, 20])
  })
})

// Only meaningful on Windows: the other platforms take the `ps` branch.
describe.runIf(process.platform === "win32")("windows process name lookup", () => {
  beforeEach(() => {
    execFileCalls.length = 0
    __resetWmicAvailabilityForTests()
  })

  it("stops re-spawning wmic after it times out", async () => {
    execFileResponder = (file) => {
      if (file === "wmic") {
        const error: Error & { killed?: boolean } = new Error("timed out")
        error.killed = true
        throw error
      }
      return { stdout: '"node.exe","910101","Console","1","12,345 K"\r\n' }
    }

    expect(await getProcessName(910_101)).toBe("node")
    expect(execFileCalls.map(([file]) => file)).toEqual(["wmic", "tasklist"])

    execFileCalls.length = 0
    expect(await getProcessName(910_102)).toBe("node")

    // A timeout is an environment failure, not a per-pid one: never retry it.
    expect(execFileCalls.map(([file]) => file)).toEqual(["tasklist"])
  })

  it("falls back to tasklist and stops re-spawning a missing wmic", async () => {
    execFileResponder = (file) => {
      if (file === "wmic") {
        const error: NodeJS.ErrnoException = new Error("spawn wmic ENOENT")
        error.code = "ENOENT"
        throw error
      }
      return { stdout: '"node.exe","910001","Console","1","12,345 K"\r\n' }
    }

    expect(await getProcessName(910_001)).toBe("node")
    const firstPass = execFileCalls.map(([file]) => file)
    expect(firstPass).toContain("tasklist")
    // PowerShell startup per PID was the expensive part of the old fallback.
    expect(firstPass).not.toContain("powershell")

    execFileCalls.length = 0
    expect(await getProcessName(910_002)).toBe("node")

    // wmic is known missing now, so it must not be probed again.
    expect(execFileCalls.map(([file]) => file)).toEqual(["tasklist"])
  })

  it("latches a generic non-zero wmic failure", async () => {
    execFileResponder = (file) => {
      if (file === "wmic") throw new Error("wmic alias exited 1")
      return { stdout: '"node.exe","910201","Console","1","12,345 K"\r\n' }
    }

    expect(await getProcessName(910_201)).toBe("node")
    expect(execFileCalls.map(([file]) => file)).toEqual(["wmic", "tasklist"])

    execFileCalls.length = 0
    expect(await getProcessName(910_202)).toBe("node")
    expect(execFileCalls.map(([file]) => file)).toEqual(["tasklist"])
  })
})
