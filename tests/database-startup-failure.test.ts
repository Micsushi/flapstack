import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { describeRequiredStartupFailure } from "../src/main/lib/startup-gate"

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
  it("provides secret-safe native recovery guidance for a corrupt database", () => {
    const error = Object.assign(new Error("file is not a database: credential=secret"), {
      code: "SQLITE_NOTADB",
    })

    expect(describeRequiredStartupFailure(error, "/profile/data/agents.db")).toEqual({
      title: "Flapstack could not start safely",
      message: "The local database could not be opened.",
      detail:
        "Flapstack did not reset or replace your local data.\n\n" +
        "Database: /profile/data/agents.db\n\n" +
        "Keep this file for recovery. Restore a known-good backup or move the damaged profile aside, then reopen Flapstack.\n\n" +
        "Reason: SQLite reported that the database is damaged or unreadable.",
    })
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
