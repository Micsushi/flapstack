import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runRequiredStartup } from "../src/main/lib/startup-gate"

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
