import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AutomationFileTriggerService,
  createDatabaseAutomationFileTriggerEnqueuer,
  type AutomationFileTriggerOccurrence,
  type AutomationFileTriggerWatchAdapter,
  type AutomationFileTriggerWatchFactory,
} from "../src/main/lib/automation/file-trigger"

const directories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("automation file triggers", () => {
  it("matches includes, custom excludes, and generated-output ignore defaults", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    mkdirSync(join(root, "src"))
    mkdirSync(join(root, "dist"))
    writeFileSync(join(root, "src", "index.ts"), "export {}")
    writeFileSync(join(root, "src", "index.test.ts"), "test")
    writeFileSync(join(root, "dist", "bundle.js"), "generated")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const service = serviceFor(harness.factory, occurrences)

    await service.replaceTriggers([
      trigger(root, {
        includeGlobs: ["src/**/*.{ts,tsx}"],
        excludeGlobs: ["**/*.test.ts"],
      }),
    ])

    expect(harness.options[0]).toMatchObject({
      ignoreInitial: true,
      followSymlinks: false,
      persistent: true,
    })
    const ignored = harness.options[0]!.ignored as (path: string) => boolean
    const watchedRoot = realpathSync(root)
    expect(ignored(join(watchedRoot, "dist"))).toBe(true)
    expect(ignored(join(watchedRoot, "nested", "node_modules"))).toBe(true)
    expect(ignored(join(watchedRoot, "src"))).toBe(false)
    harness.adapters[0]!.emit("change", join(root, "src", "index.ts"))
    harness.adapters[0]!.emit("change", join(root, "src", "index.test.ts"))
    harness.adapters[0]!.emit("change", join(root, "dist", "bundle.js"))
    await vi.advanceTimersByTimeAsync(250)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]).toMatchObject({
      automationId: "automation-1",
      triggerId: "trigger-1",
      dedupeKey: "file-change:trigger-1:batch-1",
      payload: {
        source: "file-change",
        rootPath: root,
        changedPaths: ["src/index.ts"],
        truncated: false,
      },
    })
    await service.stop()
  })

  it("coalesces an event storm into one bounded occurrence", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    mkdirSync(join(root, "src"))
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const service = serviceFor(harness.factory, occurrences)
    await service.replaceTriggers([trigger(root)])

    for (let index = 0; index < 600; index += 1) {
      const path = join(root, "src", `file-${index}.ts`)
      writeFileSync(path, String(index))
      harness.adapters[0]!.emit(index % 2 ? "change" : "add", path)
    }
    harness.adapters[0]!.emit("change", join(root, "src", "file-0.ts"))
    await vi.advanceTimersByTimeAsync(250)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.payload.changedPaths).toHaveLength(500)
    expect(occurrences[0]!.payload.truncated).toBe(true)
    await service.stop()
  })

  it("retries a failed occurrence enqueue with the same dedupe key", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    writeFileSync(join(root, "file.ts"), "file")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const errors: Error[] = []
    let attempts = 0
    const service = new AutomationFileTriggerService({
      enqueueOccurrence: (occurrence) => {
        attempts += 1
        if (attempts === 1) throw new Error("database busy")
        occurrences.push(occurrence)
      },
      watchFactory: harness.factory,
      resolveRegisteredRoot: registration,
      createDedupeId: () => "retry-batch",
      onError: (error) => errors.push(error),
    })
    await service.replaceTriggers([trigger(root)])

    harness.adapters[0]!.emit("change", join(root, "file.ts"))
    await vi.advanceTimersByTimeAsync(200)
    expect(occurrences).toEqual([])
    await vi.advanceTimersByTimeAsync(200)

    expect(attempts).toBe(2)
    expect(errors).toHaveLength(1)
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.dedupeKey).toBe("file-change:trigger-1:retry-batch")
    await service.stop()
  })

  it("cancels an enqueue retry when its trigger configuration is replaced", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    writeFileSync(join(root, "file.ts"), "file")
    const harness = watcherHarness()
    let attempts = 0
    const service = new AutomationFileTriggerService({
      enqueueOccurrence: () => {
        attempts += 1
        throw new Error("database busy")
      },
      watchFactory: harness.factory,
      resolveRegisteredRoot: registration,
    })
    await service.replaceTriggers([trigger(root)])

    harness.adapters[0]!.emit("change", join(root, "file.ts"))
    await vi.advanceTimersByTimeAsync(200)
    expect(attempts).toBe(1)

    await service.replaceTriggers([])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(attempts).toBe(1)
    await service.stop()
  })

  it("fails closed for traversal, outside paths, and symlinks", async () => {
    vi.useFakeTimers()
    const container = fixtureContainer()
    const root = join(container, "root")
    const outside = join(container, "outside")
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(join(outside, "secret.ts"), "secret")
    symlinkSync(outside, join(root, "linked"))
    writeFileSync(join(root, "safe.ts"), "safe")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const service = serviceFor(harness.factory, occurrences)
    await service.replaceTriggers([trigger(root)])

    harness.adapters[0]!.emit("change", "../outside/secret.ts")
    harness.adapters[0]!.emit("change", join(outside, "secret.ts"))
    harness.adapters[0]!.emit("change", join(root, "linked", "secret.ts"))
    harness.adapters[0]!.emit("change", join(root, "safe.ts"))
    await vi.advanceTimersByTimeAsync(250)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.payload.changedPaths).toEqual(["safe.ts"])
    await service.stop()
  })

  it("closes removed roots and ignores stale watcher events after replacement", async () => {
    vi.useFakeTimers()
    const firstRoot = fixtureRoot()
    const secondRoot = fixtureRoot()
    writeFileSync(join(firstRoot, "first.ts"), "first")
    writeFileSync(join(secondRoot, "second.ts"), "second")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const service = serviceFor(harness.factory, occurrences)

    await service.replaceTriggers([
      trigger(firstRoot),
      trigger(secondRoot, { triggerId: "trigger-2" }),
    ])
    const staleFirst = harness.adapters[0]!
    const staleSecond = harness.adapters[1]!
    await service.replaceTriggers([trigger(secondRoot, { triggerId: "trigger-2" })])

    expect(staleFirst.closed).toBe(true)
    expect(staleSecond.closed).toBe(true)
    expect(service.getWatcherCount()).toBe(1)
    staleFirst.emit("change", join(firstRoot, "first.ts"))
    staleSecond.emit("change", join(secondRoot, "second.ts"))
    harness.adapters[2]!.emit("change", join(secondRoot, "second.ts"))
    await vi.advanceTimersByTimeAsync(250)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.triggerId).toBe("trigger-2")
    await service.stop()
  })

  it("cleans timers and watchers across restart and stop", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    writeFileSync(join(root, "file.ts"), "file")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const service = serviceFor(harness.factory, occurrences)
    const config = trigger(root)

    await service.replaceTriggers([config])
    harness.adapters[0]!.emit("change", join(root, "file.ts"))
    await service.restart([config])
    expect(harness.adapters[0]!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(occurrences).toEqual([])

    harness.adapters[1]!.emit("change", join(root, "file.ts"))
    await service.stop()
    expect(harness.adapters[1]!.closed).toBe(true)
    expect(service.getWatcherCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(250)
    expect(occurrences).toEqual([])
  })

  it("disables a watcher when its registered-root identity changes", async () => {
    vi.useFakeTimers()
    const root = fixtureRoot()
    writeFileSync(join(root, "file.ts"), "file")
    const harness = watcherHarness()
    const occurrences: AutomationFileTriggerOccurrence[] = []
    const errors: Error[] = []
    let valid = true
    const service = new AutomationFileTriggerService({
      enqueueOccurrence: (occurrence) => occurrences.push(occurrence),
      watchFactory: harness.factory,
      resolveRegisteredRoot: (path) => {
        if (!valid) throw new Error("registered root filesystem identity changed")
        return registration(path)
      },
      onError: (error) => errors.push(error),
    })
    await service.replaceTriggers([trigger(root)])

    valid = false
    harness.adapters[0]!.emit("change", join(root, "file.ts"))
    await vi.waitFor(() => {
      expect(harness.adapters[0]!.closed).toBe(true)
      expect(errors).toHaveLength(1)
    })

    expect(service.getWatcherCount()).toBe(0)
    expect(occurrences).toEqual([])
    expect(errors[0]!.message).toContain("filesystem identity changed")
    await service.stop()
  })

  it("persists one pending occurrence per dedupe key", () => {
    const root = fixtureRoot()
    const databasePath = join(root, "automation.sqlite")
    const database = new Database(databasePath)
    migrate(drizzle(database), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database
      .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', ?)")
      .run(root)
    database
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode)
         VALUES ('chat-1', 'Chat', 'project', 'project-1', 'read-only')`,
      )
      .run()
    database
      .prepare(
        `INSERT INTO filesystem_root_registrations
           (path, canonical_path, bound_at) VALUES (?, ?, 1)`,
      )
      .run(root, realpathSync(root))
    database
      .prepare(
        `INSERT INTO automations (
           id, name, scope_type, chat_id, action_type, prompt, harness, permission_mode,
           state, enabled, approval_state, approved_by, approved_at, approval_audit_id,
           created_at, updated_at
         ) VALUES (
           'automation-1', 'Review', 'chat', 'chat-1', 'run-chat', 'Review it',
           'codex', 'read-only', 'active', 1, 'approved', 'local-user', 1, 'audit-1', 1, 1
         )`,
      )
      .run()
    database
      .prepare(
        `INSERT INTO automation_triggers (
           id, automation_id, type, root_path, include_globs, exclude_globs,
           debounce_ms, created_at, updated_at
         ) VALUES ('trigger-1', 'automation-1', 'file-change', ?, '["**/*"]', '[]', 200, 1, 1)`,
      )
      .run(root)
    database.close()

    let id = 0
    const enqueue = createDatabaseAutomationFileTriggerEnqueuer(
      databasePath,
      () => `occurrence-${++id}`,
    )
    const occurrence: AutomationFileTriggerOccurrence = {
      automationId: "automation-1",
      triggerId: "trigger-1",
      dedupeKey: "file-change:trigger-1:batch-1",
      scheduledFor: 1_000,
      payload: {
        source: "file-change",
        rootPath: root,
        changedPaths: ["src/index.ts"],
        truncated: false,
      },
    }

    expect(enqueue(occurrence)).toBe(true)
    expect(enqueue(occurrence)).toBe(false)
    const verify = new Database(databasePath)
    expect(
      verify
        .prepare("SELECT id, state, scheduled_for, payload FROM automation_occurrences ORDER BY id")
        .all(),
    ).toEqual([
      {
        id: "occurrence-1",
        state: "pending",
        scheduled_for: 1_000,
        payload: JSON.stringify(occurrence.payload),
      },
    ])
    verify.close()
  })
})

class FakeWatchAdapter implements AutomationFileTriggerWatchAdapter {
  private allListener: ((eventName: string, changedPath: string) => void) | null = null
  private errorListener: ((error: unknown) => void) | null = null
  closed = false

  on(
    event: "all" | "error",
    listener: ((eventName: string, changedPath: string) => void) | ((error: unknown) => void),
  ): this {
    if (event === "all") this.allListener = listener as (eventName: string, path: string) => void
    else this.errorListener = listener as (error: unknown) => void
    return this
  }

  emit(eventName: string, path: string): void {
    this.allListener?.(eventName, path)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function watcherHarness(): {
  factory: AutomationFileTriggerWatchFactory
  adapters: FakeWatchAdapter[]
  options: Array<Record<string, unknown>>
} {
  const adapters: FakeWatchAdapter[] = []
  const options: Array<Record<string, unknown>> = []
  return {
    adapters,
    options,
    factory: (_rootPath, watchOptions) => {
      const adapter = new FakeWatchAdapter()
      adapters.push(adapter)
      options.push(watchOptions as Record<string, unknown>)
      return adapter
    },
  }
}

function serviceFor(
  watchFactory: AutomationFileTriggerWatchFactory,
  occurrences: AutomationFileTriggerOccurrence[],
): AutomationFileTriggerService {
  let batch = 0
  return new AutomationFileTriggerService({
    enqueueOccurrence: (occurrence) => occurrences.push(occurrence),
    watchFactory,
    resolveRegisteredRoot: registration,
    now: () => 1_000,
    createDedupeId: () => `batch-${++batch}`,
  })
}

function trigger(
  rootPath: string,
  overrides: Partial<Parameters<AutomationFileTriggerService["replaceTriggers"]>[0][number]> = {},
) {
  return {
    triggerId: "trigger-1",
    automationId: "automation-1",
    rootPath,
    includeGlobs: ["**/*"],
    debounceMs: 200,
    ...overrides,
  }
}

function registration(path: string) {
  return {
    path,
    canonicalPath: realpathSync(path),
    deviceId: null,
    inodeId: null,
  }
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-automation-file-trigger-"))
  directories.push(root)
  return root
}

function fixtureContainer(): string {
  const container = mkdtempSync(join(tmpdir(), "flapstack-automation-file-trigger-container-"))
  directories.push(container)
  return container
}
