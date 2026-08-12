import { beforeEach, describe, expect, it, vi } from "vitest"

// One enumeration of the whole process table, shared by every root.
let processTable: Array<{ pid: number; ppid: number }> = []
let enumerationCount = 0
let enumerationError: Error | null = null

vi.mock("pidtree", () => ({
  default: async (pid: number, options?: { advanced?: boolean }) => {
    if (pid !== -1 || !options?.advanced) throw new Error("unexpected pidtree call")
    enumerationCount++
    if (enumerationError) throw enumerationError
    return processTable
  },
}))

const { getProcessTrees } = await import("../src/main/lib/terminal/port-scanner")

describe("getProcessTrees", () => {
  beforeEach(() => {
    enumerationCount = 0
    enumerationError = null
    processTable = [
      { pid: 100, ppid: 1 },
      { pid: 101, ppid: 100 },
      { pid: 102, ppid: 101 },
      { pid: 200, ppid: 1 },
      { pid: 201, ppid: 200 },
      { pid: 999, ppid: 1 },
    ]
  })

  it("resolves every root from a single enumeration", async () => {
    const trees = await getProcessTrees([100, 200])

    expect(enumerationCount).toBe(1)
    expect(trees.get(100)?.sort((a, b) => a - b)).toEqual([100, 101, 102])
    expect(trees.get(200)?.sort((a, b) => a - b)).toEqual([200, 201])
  })

  it("never attributes an unrelated process to a root", async () => {
    const trees = await getProcessTrees([100])

    expect(trees.get(100)).not.toContain(999)
    expect(trees.get(100)).not.toContain(200)
  })

  it("does not enumerate when there are no roots", async () => {
    const trees = await getProcessTrees([])

    expect(enumerationCount).toBe(0)
    expect(trees.size).toBe(0)
  })

  it("falls back to the root itself when enumeration fails", async () => {
    enumerationError = new Error("no process table")

    const trees = await getProcessTrees([100])

    expect(trees.get(100)).toEqual([100])
  })

  it("terminates on a cyclic (stale) process table", async () => {
    processTable = [
      { pid: 100, ppid: 101 },
      { pid: 101, ppid: 100 },
    ]

    const trees = await getProcessTrees([100])

    expect(trees.get(100)?.sort((a, b) => a - b)).toEqual([100, 101])
  })
})
