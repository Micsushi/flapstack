import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-policy-router",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import { closeDatabase, getDatabase } from "../src/main/lib/db"
import {
  startProductMcpInvalidationBridge,
  type ProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import { providerExtensionsRouter } from "../src/main/lib/trpc/routers/provider-extensions"
import type { ProductMcpRendererInvalidation } from "../src/shared/product-mcp-invalidation"

let directory = ""
let databasePath = ""
let projectRoot = ""
let bridge: ProductMcpInvalidationBridge | null = null

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-policy-router-"))
  databasePath = join(directory, "agents.db")
  projectRoot = join(directory, "project")
  mkdirSync(projectRoot)
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_TEST_USER_DATA = directory

  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
    .run(projectRoot)
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite.close()
  bindFilesystemRootIdentity(projectRoot, getDatabase())
})

afterEach(async () => {
  await bridge?.stop()
  bridge = null
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("extension policy production router", () => {
  it("publishes set and clear invalidation to every window bridge and rejects stale IDs", async () => {
    const skillPath = join(projectRoot, ".claude", "skills", "router-policy", "SKILL.md")
    mkdirSync(resolve(skillPath, ".."), { recursive: true })
    writeFileSync(
      skillPath,
      "---\nname: router-policy\ndescription: router fixture\n---\nfixture\n",
    )
    const received: ProductMcpRendererInvalidation[] = []
    bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    const caller = providerExtensionsRouter.createCaller({ getWindow: () => null })
    const location = { type: "task" as const, projectId: "project-1", taskId: "task-1" }
    const extensionId = (await caller.list({ cwd: projectRoot })).find(
      (extension) => extension.name === "router-policy",
    )?.id
    expect(extensionId).toBeDefined()

    await expect(
      caller.setEnablementPolicy({
        extensionId: "claude:skill:stale",
        cwd: projectRoot,
        location,
        enabled: false,
      }),
    ).rejects.toThrow("Extension not found in the requested inventory")
    expect(received).toEqual([])

    await expect(
      caller.setEnablementPolicy({
        extensionId: extensionId!,
        cwd: projectRoot,
        location,
        enabled: false,
      }),
    ).resolves.toMatchObject({ enabled: false, source: "task" })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["provider-extensions"],
      projectIds: ["project-1"],
      taskIds: ["task-1"],
    })

    await expect(
      caller.resolveEnablement({ extensionId: extensionId!, cwd: projectRoot, location }),
    ).resolves.toMatchObject({ enabled: false, source: "task" })
    await expect(
      caller.clearEnablementPolicy({ extensionId: extensionId!, cwd: projectRoot, location }),
    ).resolves.toMatchObject({ enabled: true, source: "fixed-default" })
    await vi.waitFor(() => expect(received).toHaveLength(2))
  })

  it("publishes native apply and restore invalidation only after successful writes", async () => {
    const skillPath = join(projectRoot, ".claude", "skills", "router-native", "SKILL.md")
    mkdirSync(resolve(skillPath, ".."), { recursive: true })
    writeFileSync(
      skillPath,
      "---\nname: router-native\ndescription: native fixture\n---\noriginal\n",
    )
    const received: ProductMcpRendererInvalidation[] = []
    bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    const caller = providerExtensionsRouter.createCaller({ getWindow: () => null })
    const target = {
      harness: "claude-code" as const,
      kind: "skill" as const,
      scope: "project" as const,
      name: "router-native",
      cwd: projectRoot,
    }
    const mutation = {
      operation: "update" as const,
      target,
      changes: { content: "updated\n" },
    }
    const preview = await caller.previewNativeMutation(mutation)

    await expect(
      caller.applyNativeMutation({
        ...mutation,
        expectedHash: preview.beforeHash,
        confirmationHash: "0".repeat(64),
      }),
    ).rejects.toThrow("preview confirmation is stale or invalid")
    expect(received).toEqual([])

    const applied = await caller.applyNativeMutation({
      ...mutation,
      expectedHash: preview.beforeHash,
      confirmationHash: preview.confirmationHash,
    })
    expect(applied.backup).not.toBeNull()
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["provider-extensions"],
    })

    await caller.restoreNativeBackup({ target, backupId: applied.backup!.backupId })
    await vi.waitFor(() => expect(received).toHaveLength(2))
  })

  it("publishes cross-harness copy invalidation only after a successful copy", async () => {
    const sourcePath = join(projectRoot, ".claude", "skills", "router-copy", "SKILL.md")
    mkdirSync(resolve(sourcePath, ".."), { recursive: true })
    writeFileSync(
      sourcePath,
      "---\nname: router-copy\ndescription: router copy fixture\n---\noriginal\n",
    )
    const received: ProductMcpRendererInvalidation[] = []
    bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    const caller = providerExtensionsRouter.createCaller({ getWindow: () => null })
    const source = {
      harness: "claude-code" as const,
      kind: "skill" as const,
      scope: "project" as const,
      name: "router-copy",
      cwd: projectRoot,
    }
    const target = { ...source, harness: "codex" as const }
    const copy = { source, target, collisionPolicy: "reject" as const }
    const stalePreview = await caller.previewCrossHarnessCopy(copy)

    writeFileSync(
      sourcePath,
      "---\nname: router-copy\ndescription: router copy fixture\n---\nchanged\n",
    )
    await expect(
      caller.applyCrossHarnessCopy({
        ...copy,
        expectedSourceHash: stalePreview.sourceHash!,
        expectedTargetHash: stalePreview.targetBeforeHash,
        confirmationHash: stalePreview.confirmationHash!,
      }),
    ).rejects.toThrow("Source extension changed after copy preview")
    expect(received).toEqual([])

    const preview = await caller.previewCrossHarnessCopy(copy)
    await expect(
      caller.applyCrossHarnessCopy({
        ...copy,
        expectedSourceHash: preview.sourceHash!,
        expectedTargetHash: preview.targetBeforeHash,
        confirmationHash: preview.confirmationHash!,
      }),
    ).resolves.toMatchObject({ sourcePreserved: true })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["provider-extensions"],
    })
  })
})
