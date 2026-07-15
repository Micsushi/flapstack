import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runIsolatedStartupTasks, runRequiredStartup } from "../src/main/lib/startup-gate"

const directories: string[] = []

afterEach(() => {
  vi.doUnmock("../src/main/lib/permissions")
  vi.resetModules()
  delete process.env.FLAPSTACK_DB_PATH
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("required database startup", () => {
  it("continues later startup services after an optional service fails", async () => {
    const order: string[] = []
    const report = vi.fn()

    await runIsolatedStartupTasks(
      [
        { name: "bridge", run: () => Promise.reject(new Error("bridge unavailable")) },
        { name: "scheduler", run: () => order.push("scheduler") },
        { name: "usage", run: () => order.push("usage") },
      ],
      report,
    )

    expect(order).toEqual(["scheduler", "usage"])
    expect(report).toHaveBeenCalledWith("bridge", expect.any(Error))
  })

  it("awaits an optional service first pass before starting the next service", async () => {
    const order: string[] = []
    let finishScheduler!: () => void
    const schedulerFirstPass = new Promise<void>((resolve) => {
      finishScheduler = resolve
    })
    const startup = runIsolatedStartupTasks(
      [
        {
          name: "automation scheduler",
          run: async () => {
            order.push("scheduler:start")
            await schedulerFirstPass
            order.push("scheduler:ready")
          },
        },
        { name: "next service", run: () => order.push("next") },
      ],
      vi.fn(),
    )

    await Promise.resolve()
    expect(order).toEqual(["scheduler:start"])
    finishScheduler()
    await startup
    expect(order).toEqual(["scheduler:start", "scheduler:ready", "next"])
  })

  it("closes and exits without continuing to a window after initialization fails", async () => {
    const cleanup = vi.fn()
    const continueStartup = vi.fn()
    const exit = vi.fn()
    const report = vi.fn()

    await expect(
      runRequiredStartup({
        initialize: () => {
          throw new Error("permission recovery failed")
        },
        cleanup,
        continueStartup,
        exit,
        report,
      }),
    ).resolves.toBe(false)

    expect(cleanup).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
    expect(report).toHaveBeenCalledOnce()
    expect(continueStartup).not.toHaveBeenCalled()
  })

  it("does not publish a database singleton when permission recovery fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-db-recovery-failure-"))
    directories.push(directory)
    process.env.FLAPSTACK_DB_PATH = join(directory, "agents.db")
    const recover = vi.fn(() => {
      throw new Error("injected recovery failure")
    })
    vi.resetModules()
    vi.doMock("../src/main/lib/permissions", async () => {
      const actual = await vi.importActual<typeof import("../src/main/lib/permissions")>(
        "../src/main/lib/permissions",
      )
      return { ...actual, recoverPendingAllChatPermissionChange: recover }
    })
    const database = await import("../src/main/lib/db")

    expect(() => database.initDatabase()).toThrow("injected recovery failure")
    expect(() => database.getDatabase()).toThrow("injected recovery failure")
    expect(recover).toHaveBeenCalledTimes(2)
    expect(() => database.closeDatabase()).not.toThrow()
  })
})
