import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-vault-router",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}))

import * as schema from "../src/main/lib/db/schema"
import { closeDatabase } from "../src/main/lib/db"
import {
  startProductMcpInvalidationBridge,
  type ProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import { projectVaultsRouter } from "../src/main/lib/trpc/routers/project-vaults"
import type { ProductMcpRendererInvalidation } from "../src/shared/product-mcp-invalidation"

describe("project vault renderer invalidation", () => {
  let directory = ""
  let bridge: ProductMcpInvalidationBridge | null = null

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-vault-router-"))
    const databasePath = join(directory, "agents.db")
    const projectRoot = join(directory, "project")
    mkdirSync(projectRoot)
    process.env.FLAPSTACK_DB_PATH = databasePath
    process.env.FLAPSTACK_TEST_USER_DATA = join(directory, "profile")
    mkdirSync(process.env.FLAPSTACK_TEST_USER_DATA, { recursive: true })

    const sqlite = new Database(databasePath)
    sqlite.pragma("foreign_keys = ON")
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite
      .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
      .run(projectRoot)
    sqlite.close()
  })

  afterEach(async () => {
    await bridge?.stop()
    bridge = null
    closeDatabase()
    delete process.env.FLAPSTACK_DB_PATH
    delete process.env.FLAPSTACK_TEST_USER_DATA
    rmSync(directory, { recursive: true, force: true })
  })

  it("publishes ordinary v2 and conflict-resolution v3 only after successful writes", async () => {
    const received: ProductMcpRendererInvalidation[] = []
    bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    const caller = projectVaultsRouter.createCaller({ getWindow: () => null })
    await caller.scaffold({ projectId: "project-1", sections: ["context"] })

    await expect(
      caller.writeSection({
        projectId: "project-1",
        sectionId: "context",
        expectedVersion: 1,
        content: "main window saved",
        changeKind: "section-saved",
      }),
    ).resolves.toMatchObject({ version: 2 })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["vaults"],
      vaultChanges: [
        {
          projectId: "project-1",
          sectionId: "context",
          revision: 2,
          kind: "section-saved",
        },
      ],
    })

    await expect(
      caller.writeSection({
        projectId: "project-1",
        sectionId: "context",
        expectedVersion: 2,
        content: "window two preserved draft",
        changeKind: "conflict-resolved",
      }),
    ).resolves.toMatchObject({ version: 3 })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received[1]?.vaultChanges).toEqual([
      {
        projectId: "project-1",
        sectionId: "context",
        revision: 3,
        kind: "conflict-resolved",
      },
    ])

    const backup = (await caller.listBackups({ projectId: "project-1", sectionId: "context" }))[0]!
    await expect(
      caller.restoreBackup({
        projectId: "project-1",
        sectionId: "context",
        backupId: backup.id,
        expectedVersion: 3,
      }),
    ).resolves.toMatchObject({ version: 4 })
    await vi.waitFor(() => expect(received).toHaveLength(3))
    expect(received[2]?.vaultChanges?.[0]).toMatchObject({
      revision: 4,
      kind: "backup-restored",
    })

    const policy = await caller.getPolicy({ projectId: "project-1" })
    const external = "external safe content"
    writeFileSync(join(policy.vaultPath, "context.md"), external)
    await expect(
      caller.adoptExternalChange({
        projectId: "project-1",
        sectionId: "context",
        expectedVersion: 4,
        expectedCurrentContentHash: createHash("sha256").update(external).digest("hex"),
      }),
    ).resolves.toMatchObject({ version: 5 })
    await vi.waitFor(() => expect(received).toHaveLength(4))
    expect(received[3]?.vaultChanges?.[0]).toMatchObject({
      revision: 5,
      kind: "external-change-adopted",
    })

    await expect(
      caller.writeSection({
        projectId: "project-1",
        sectionId: "context",
        expectedVersion: 2,
        content: "stale write",
        changeKind: "section-saved",
      }),
    ).rejects.toThrow("version is stale")
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    expect(received).toHaveLength(4)
  })
})
