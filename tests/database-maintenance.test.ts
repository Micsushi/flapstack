import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { tempRoot } from "./portability-test-helpers"

afterEach(() => {
  delete process.env.FLAPSTACK_DB_PATH
  vi.doUnmock("electron")
  vi.resetModules()
})

describe("database maintenance coordinator", () => {
  it("recovers provably dead owner and access markers but preserves a live foreign owner", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "agents.db")
    const access = await import("../src/main/lib/db/access")
    const canonical = access.canonicalDatabasePath(databasePath)
    const ownerPath = `${canonical}.flapstack-maintenance`
    const accessRoot = `${canonical}.flapstack-access`
    const deadMarker = {
      schemaVersion: 1,
      pid: 2_147_483_647,
      processNonce: randomUUID(),
      processStartIdentity: null,
    }
    await writeFile(
      ownerPath,
      `${JSON.stringify({ ...deadMarker, kind: "owner", owner: "dead" })}\n`,
    )
    const opened = access.openAppDatabase(databasePath)
    opened.close()
    await expect(readFile(ownerPath)).rejects.toMatchObject({ code: "ENOENT" })

    await mkdir(accessRoot, { recursive: true })
    const deadAccessPath = join(accessRoot, "dead.json")
    await writeFile(deadAccessPath, `${JSON.stringify({ ...deadMarker, kind: "access" })}\n`)
    const lease = access.beginDatabaseAccessMaintenance(databasePath, "orphan-test")
    await lease.waitForDrain()
    await expect(readFile(deadAccessPath)).rejects.toMatchObject({ code: "ENOENT" })
    lease.release()

    await writeFile(
      ownerPath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "owner",
        owner: "live-foreign",
        pid: process.pid,
        processNonce: randomUUID(),
        processStartIdentity: null,
      })}\n`,
    )
    expect(() => access.openAppDatabase(databasePath)).toThrow(/paused for bounded maintenance/i)
    await expect(readFile(ownerPath, "utf8")).resolves.toContain("live-foreign")
    await rm(ownerPath)
  })

  it("waits for a pre-admitted async singleton operation before closing the database", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon: vi.fn(async () => false),
      startInstalledUsageDaemon: vi.fn(),
    }))
    const database = await import("../src/main/lib/db")
    database.initDatabase()
    let releaseUser!: () => void
    const paused = new Promise<void>((resolve) => {
      releaseUser = resolve
    })
    let admitted = false
    const operation = database.withDatabaseOperation(async () => {
      const held = database.getDatabase() as unknown as {
        $client: { exec(sql: string): void }
      }
      admitted = true
      await paused
      held.$client.exec("CREATE TABLE admitted_after_await (value TEXT)")
    })
    await vi.waitFor(() => expect(admitted).toBe(true))
    let maintenanceSettled = false
    const maintenance = database.beginDatabaseMaintenance("async-singleton-test").then(() => {
      maintenanceSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(maintenanceSettled).toBe(false)
    releaseUser()
    await operation
    await maintenance
    await database.endDatabaseMaintenance("async-singleton-test")
    database.closeDatabase()
  })
})
