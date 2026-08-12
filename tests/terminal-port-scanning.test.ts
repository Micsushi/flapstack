import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getProcessTrees = vi.fn<(rootPids: number[]) => Promise<Map<number, number[]>>>()
const getListeningPortsForPids =
  vi.fn<
    (
      pids: number[],
    ) => Promise<Array<{ port: number; pid: number; address: string; processName: string }>>
  >()

vi.mock("../src/main/lib/terminal/port-scanner", () => ({
  getProcessTrees: (rootPids: number[]) => getProcessTrees(rootPids),
  getListeningPortsForPids: (pids: number[]) => getListeningPortsForPids(pids),
  getProcessName: async () => "node",
}))

const { portManager } = await import("../src/main/lib/terminal/port-manager")

function fakeSession(paneId: string, pid: number) {
  return { paneId, isAlive: true, pty: { pid } } as never
}

function treesOf(rootPids: number[], descendants: (pid: number) => number[]) {
  return new Map(rootPids.map((pid) => [pid, descendants(pid)]))
}

describe("port manager scanning", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getProcessTrees.mockReset()
    getListeningPortsForPids.mockReset()
    getListeningPortsForPids.mockResolvedValue([])
    getProcessTrees.mockImplementation(async (rootPids) => treesOf(rootPids, (pid) => [pid]))
  })

  afterEach(() => {
    portManager.unregisterSession("pane-a")
    portManager.unregisterSession("pane-b")
    vi.useRealTimers()
  })

  it("enumerates processes once per pass regardless of pane count", async () => {
    getProcessTrees.mockImplementation(async (rootPids) =>
      treesOf(rootPids, (pid) => [pid, pid + 1000]),
    )

    portManager.registerSession(fakeSession("pane-a", 1), "ws")
    portManager.registerSession(fakeSession("pane-b", 2), "ws")

    await portManager.forceScan()

    expect(getProcessTrees).toHaveBeenCalledTimes(1)
    expect(getProcessTrees.mock.calls[0][0].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it("makes one port lookup per pass regardless of pane count", async () => {
    getProcessTrees.mockImplementation(async (rootPids) =>
      treesOf(rootPids, (pid) => [pid, pid + 1000]),
    )
    getListeningPortsForPids.mockResolvedValue([
      { port: 3000, pid: 1001, address: "0.0.0.0", processName: "node" },
      { port: 4000, pid: 1002, address: "0.0.0.0", processName: "node" },
    ])

    portManager.registerSession(fakeSession("pane-a", 1), "ws")
    portManager.registerSession(fakeSession("pane-b", 2), "ws")

    await portManager.forceScan()

    expect(getListeningPortsForPids).toHaveBeenCalledTimes(1)
    expect(getListeningPortsForPids.mock.calls[0][0].sort((a, b) => a - b)).toEqual([
      1, 2, 1001, 1002,
    ])
  })

  it("attributes each port only to the pane whose tree owns its pid", async () => {
    // pane-a owns 1 and its child 11; pane-b owns 2 and its child 22.
    getProcessTrees.mockImplementation(async (rootPids) =>
      treesOf(rootPids, (pid) => [pid, pid * 11]),
    )
    getListeningPortsForPids.mockResolvedValue([
      { port: 3000, pid: 11, address: "0.0.0.0", processName: "node" },
      { port: 4000, pid: 22, address: "0.0.0.0", processName: "node" },
    ])

    portManager.registerSession(fakeSession("pane-a", 1), "ws")
    portManager.registerSession(fakeSession("pane-b", 2), "ws")

    await portManager.forceScan()

    const ports = portManager.getAllPorts()
    expect(ports.find((p) => p.port === 3000)?.paneId).toBe("pane-a")
    expect(ports.find((p) => p.port === 4000)?.paneId).toBe("pane-b")
  })

  it("does not scan while no session is registered", async () => {
    // Nothing registered: the interval must not be running at import time.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getProcessTrees).not.toHaveBeenCalled()

    portManager.registerSession(fakeSession("pane-a", 1), "ws")
    await vi.advanceTimersByTimeAsync(2_500)
    expect(getProcessTrees).toHaveBeenCalled()

    getProcessTrees.mockClear()
    portManager.unregisterSession("pane-a")
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getProcessTrees).not.toHaveBeenCalled()
  })
})
