import { randomUUID } from "node:crypto"
import { renameSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import { tempRoot } from "./portability-test-helpers"

afterEach(() => {
  delete process.env.FLAPSTACK_DB_PATH
  vi.doUnmock("electron")
  vi.resetModules()
})

describe("database maintenance coordinator", () => {
  it("loads an explicit headless database path without Electron", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    vi.doMock("electron", () => {
      throw new Error("Electron is unavailable in the packaged Node sidecar")
    })

    const database = await import("../src/main/lib/db")
    expect(database.getDatabasePath()).toBe(process.env.FLAPSTACK_DB_PATH)
  })

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

  it.skipIf(!fileSymlinksSupported)(
    "canonicalizes lexical and symlink aliases into one maintenance namespace",
    async () => {
      const root = await tempRoot()
      const realRoot = join(root, "real")
      const aliasRoot = join(root, "alias")
      await mkdir(realRoot)
      await symlink(realRoot, aliasRoot)
      const access = await import("../src/main/lib/db/access")
      const realPath = join(realRoot, "agents.db")
      const aliasPath = join(aliasRoot, ".", "agents.db")
      expect(access.canonicalDatabasePath(aliasPath)).toBe(access.canonicalDatabasePath(realPath))
      const lease = access.beginDatabaseAccessMaintenance(realPath, "alias-test")
      expect(() => access.openAppDatabase(aliasPath)).toThrow(/paused for bounded maintenance/i)
      lease.release()
    },
  )

  it("does not let a stale lease release delete a replacement live owner", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "agents.db")
    const access = await import("../src/main/lib/db/access")
    const ownerPath = `${access.canonicalDatabasePath(databasePath)}.flapstack-maintenance`
    const oldOwnerPath = `${ownerPath}.old`
    const lease = access.beginDatabaseAccessMaintenance(databasePath, "old-owner")
    access.setDatabaseAccessTestHooks({
      beforeMarkerQuarantine: (path, kind) => {
        if (kind !== "owner") return
        renameSync(path, oldOwnerPath)
        writeFileSync(
          path,
          `${JSON.stringify({
            schemaVersion: 1,
            kind: "owner",
            owner: "replacement-live-owner",
            pid: process.pid,
            processNonce: randomUUID(),
            processStartIdentity: null,
          })}\n`,
        )
      },
    })
    expect(() => lease.release()).toThrow(/marker changed/i)
    access.setDatabaseAccessTestHooks(null)
    const quarantineRoot = `${access.canonicalDatabasePath(databasePath)}.flapstack-marker-quarantine/owner`
    const [quarantined] = await readdir(quarantineRoot)
    await expect(readFile(join(quarantineRoot, quarantined!), "utf8")).resolves.toContain(
      "replacement-live-owner",
    )
    await rm(quarantineRoot, { recursive: true })
    await rm(oldOwnerPath)
  })

  it("does not let a closed opener delete a replacement access marker", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "agents.db")
    const access = await import("../src/main/lib/db/access")
    const canonical = access.canonicalDatabasePath(databasePath)
    const markerRoot = `${canonical}.flapstack-access`
    const database = access.openAppDatabase(databasePath)
    const [entry] = await readdir(markerRoot)
    const markerPath = join(markerRoot, entry!)
    const oldMarkerPath = `${markerPath}.old`
    access.setDatabaseAccessTestHooks({
      beforeMarkerQuarantine: (path, kind) => {
        if (kind !== "access") return
        renameSync(path, oldMarkerPath)
        writeFileSync(
          path,
          `${JSON.stringify({
            schemaVersion: 1,
            kind: "access",
            pid: process.pid,
            processNonce: randomUUID(),
            processStartIdentity: null,
          })}\n`,
        )
      },
    })
    expect(() => database.close()).toThrow(/marker changed/i)
    access.setDatabaseAccessTestHooks(null)
    const quarantineRoot = `${canonical}.flapstack-marker-quarantine/access`
    const [quarantined] = await readdir(quarantineRoot)
    await expect(readFile(join(quarantineRoot, quarantined!), "utf8")).resolves.toContain(
      '"kind":"access"',
    )
    await rm(quarantineRoot, { recursive: true })
    await rm(oldMarkerPath)
  })

  it.skipIf(!fileSymlinksSupported)(
    "does not follow a symlink swapped at the marker quarantine boundary",
    async () => {
      const root = await tempRoot()
      const databasePath = join(root, "agents.db")
      const access = await import("../src/main/lib/db/access")
      const canonical = access.canonicalDatabasePath(databasePath)
      const ownerPath = `${canonical}.flapstack-maintenance`
      const oldOwnerPath = `${ownerPath}.old`
      const outsidePath = join(root, "outside-marker.json")
      await writeFile(outsidePath, '{"outside":"unchanged"}\n')
      const lease = access.beginDatabaseAccessMaintenance(databasePath, "symlink-swap")
      access.setDatabaseAccessTestHooks({
        beforeMarkerQuarantine: (path, kind) => {
          if (kind !== "owner") return
          renameSync(path, oldOwnerPath)
          symlinkSync(outsidePath, path)
        },
      })
      expect(() => lease.release()).toThrow(/marker is invalid/i)
      access.setDatabaseAccessTestHooks(null)
      await expect(readFile(outsidePath, "utf8")).resolves.toBe('{"outside":"unchanged"}\n')
      await rm(`${canonical}.flapstack-marker-quarantine`, { recursive: true })
      await rm(oldOwnerPath)
    },
  )

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

  it("drains an opener acquired before maintenance and rejects a cached-path service until resume", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon: vi.fn(async () => false),
      startInstalledUsageDaemon: vi.fn(),
    }))
    const database = await import("../src/main/lib/db")
    const access = await import("../src/main/lib/db/access")
    const cachedPath = database.getDatabasePath()
    const activeWriter = access.openAppDatabase(cachedPath)
    activeWriter.exec("CREATE TABLE delayed_writes (value TEXT NOT NULL)")
    let maintenanceSettled = false
    const maintenance = database.beginDatabaseMaintenance("cached-service-test").then(() => {
      maintenanceSettled = true
    })
    await vi.waitFor(() => expect(database.isDatabaseMaintenanceActive()).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(maintenanceSettled).toBe(false)
    activeWriter.prepare("INSERT INTO delayed_writes VALUES (?)").run("drained")
    activeWriter.close()
    await maintenance
    expect(() => access.openAppDatabase(cachedPath)).toThrow(/paused for bounded maintenance/i)
    await database.endDatabaseMaintenance("cached-service-test")
    const resumed = access.openAppDatabase(cachedPath, { readonly: true })
    expect(resumed.prepare("SELECT value FROM delayed_writes").pluck().get()).toBe("drained")
    resumed.close()
    database.closeDatabase()
  })

  it("blocks every database-path opener while a scheduler participant drains", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    const stopInstalledUsageDaemon = vi.fn(async () => false)
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon,
      startInstalledUsageDaemon: vi.fn(),
    }))
    const database = await import("../src/main/lib/db")
    let releaseDrain!: () => void
    const drained = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    const events: string[] = []
    database.registerDatabaseMaintenanceParticipant("test-scheduler", {
      pause: async () => {
        events.push("pause-start")
        await drained
        events.push("pause-complete")
      },
      resume: () => events.push("resume"),
    })

    const lease = database.beginDatabaseMaintenance("test-import")
    expect(database.isDatabaseMaintenanceActive()).toBe(true)
    expect(() => database.getDatabasePath()).toThrow(/paused for bounded maintenance/i)
    expect(() => database.getDatabase()).toThrow(/paused for bounded maintenance/i)
    await vi.waitFor(() => expect(events).toEqual(["pause-start"]))
    releaseDrain()
    await lease
    expect(events).toEqual(["pause-start", "pause-complete"])
    expect(stopInstalledUsageDaemon).toHaveBeenCalledOnce()
  })

  it("stops by installed profile before database initialization and never signals a stale PID", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    const stopInstalledUsageDaemon = vi.fn(async () => true)
    const startInstalledUsageDaemon = vi.fn()
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon,
      startInstalledUsageDaemon,
    }))
    const kill = vi.spyOn(process, "kill")
    const database = await import("../src/main/lib/db")
    await database.beginDatabaseMaintenance("startup-recovery")
    expect(stopInstalledUsageDaemon).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
    expect(startInstalledUsageDaemon).not.toHaveBeenCalled()
    kill.mockRestore()
  })

  it("keeps maintenance active when failed begin cleanup cannot release the access lease", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    const startInstalledUsageDaemon = vi.fn()
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon: vi.fn(async () => true),
      startInstalledUsageDaemon,
    }))
    const database = await import("../src/main/lib/db")
    const access = await import("../src/main/lib/db/access")
    const events: string[] = []
    database.registerDatabaseMaintenanceParticipant("paused-before-failure", {
      pause: () => events.push("first-pause"),
      resume: () => events.push("first-resume"),
    })
    database.registerDatabaseMaintenanceParticipant("begin-failure", {
      pause: () => {
        events.push("second-pause")
        access.setDatabaseAccessTestHooks({
          beforeMarkerQuarantine: (_path, kind) => {
            if (kind === "owner") throw new Error("lease release failed")
          },
        })
        throw new Error("participant pause failed")
      },
      resume: () => events.push("second-resume"),
    })

    const failure = await database.beginDatabaseMaintenance("failed-begin").then(
      () => null,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map(String).join("\n")).toContain(
      "participant pause failed",
    )
    expect((failure as AggregateError).errors.map(String).join("\n")).toContain(
      "lease release failed",
    )
    expect(events).toEqual(["first-pause", "second-pause", "first-resume"])
    expect(database.isDatabaseMaintenanceActive()).toBe(true)
    expect(startInstalledUsageDaemon).not.toHaveBeenCalled()

    access.setDatabaseAccessTestHooks(null)
    await database.endDatabaseMaintenance("failed-begin")
    expect(database.isDatabaseMaintenanceActive()).toBe(false)
    expect(startInstalledUsageDaemon).toHaveBeenCalledOnce()
    database.closeDatabase()
  })

  it("keeps maintenance active while end cleanup cannot release the access lease", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    const startInstalledUsageDaemon = vi.fn()
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon: vi.fn(async () => true),
      startInstalledUsageDaemon,
    }))
    const database = await import("../src/main/lib/db")
    const access = await import("../src/main/lib/db/access")
    const activeDuringResume: boolean[] = []
    database.registerDatabaseMaintenanceParticipant("release-failure", {
      pause: vi.fn(),
      resume: () => activeDuringResume.push(database.isDatabaseMaintenanceActive()),
    })
    await database.beginDatabaseMaintenance("failed-end")
    access.setDatabaseAccessTestHooks({
      beforeMarkerQuarantine: (_path, kind) => {
        if (kind === "owner") throw new Error("lease release failed")
      },
    })

    await expect(database.endDatabaseMaintenance("failed-end")).rejects.toThrow(
      "lease release failed",
    )
    expect(database.isDatabaseMaintenanceActive()).toBe(true)
    expect(activeDuringResume).toEqual([true])
    expect(startInstalledUsageDaemon).not.toHaveBeenCalled()
    expect(() => access.openAppDatabase(process.env.FLAPSTACK_DB_PATH!)).toThrow(
      /paused for bounded maintenance/i,
    )

    access.setDatabaseAccessTestHooks(null)
    await database.endDatabaseMaintenance("failed-end")
    expect(activeDuringResume).toEqual([true, false])
    expect(database.isDatabaseMaintenanceActive()).toBe(false)
    expect(startInstalledUsageDaemon).toHaveBeenCalledOnce()
    database.closeDatabase()
  })

  it("releases database guards before participant resume cleanup", async () => {
    process.env.FLAPSTACK_DB_PATH = join(await tempRoot(), "agents.db")
    const startInstalledUsageDaemon = vi.fn()
    vi.doMock("../src/main/lib/usage-daemon/platform", () => ({
      stopInstalledUsageDaemon: vi.fn(async () => false),
      startInstalledUsageDaemon,
    }))
    const database = await import("../src/main/lib/db")
    const access = await import("../src/main/lib/db/access")
    database.initDatabase()
    let activeDuringResume = true
    let databaseAvailableDuringResume = false
    let externalAccessAvailableDuringResume = false
    database.registerDatabaseMaintenanceParticipant("resume-failure", {
      pause: vi.fn(),
      resume: () => {
        activeDuringResume = database.isDatabaseMaintenanceActive()
        databaseAvailableDuringResume = database.getDatabase() !== null
        try {
          access.openAppDatabase(process.env.FLAPSTACK_DB_PATH!).close()
          externalAccessAvailableDuringResume = true
        } catch {}
        throw new Error("resume failed")
      },
    })
    await database.beginDatabaseMaintenance("resume-failure-test")
    await expect(database.endDatabaseMaintenance("resume-failure-test")).rejects.toThrow(
      "resume failed",
    )
    expect(activeDuringResume).toBe(false)
    expect(databaseAvailableDuringResume).toBe(true)
    expect(externalAccessAvailableDuringResume).toBe(true)
    expect(database.isDatabaseMaintenanceActive()).toBe(false)
    expect(startInstalledUsageDaemon).not.toHaveBeenCalled()
    database.closeDatabase()
  })
})
