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

  it("never attributes an unrelated process to a root", async () => {
    const trees = await getProcessTrees([100])

    expect(trees.get(100)).not.toContain(999)
    expect(trees.get(100)).not.toContain(200)
  })
})
