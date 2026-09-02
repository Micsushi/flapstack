import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  startProductMcpInvalidationBridge,
  type ProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import {
  ProjectVaultGraphIndex,
  currentProjectVaultGraph,
} from "../src/main/lib/project-vaults/graph-index"
import type { ProductMcpRendererInvalidation } from "../src/shared/product-mcp-invalidation"

let directory = ""
let root = ""
let sqlite: Database.Database
let invalidationBridge: ProductMcpInvalidationBridge | null = null

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-vault-graph-"))
  root = join(directory, "vault")
  mkdirSync(root)
  sqlite = new Database(join(directory, "graph.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.pragma("foreign_keys = ON")
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Graph', ?)")
    .run(directory)
  sqlite
    .prepare(
      `INSERT INTO project_vaults
       (project_id, root_path, schema_version, created_at, updated_at)
       VALUES ('project-1', ?, 2, 1, 1)`,
    )
    .run(root)
  bindFilesystemRootIdentity(root, drizzle(sqlite, { schema }))
})

afterEach(async () => {
  await invalidationBridge?.stop()
  invalidationBridge = null
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("project vault graph generations", () => {
  it("commits one exact generation with resolved links and backlinks", async () => {
    writeFileSync(
      join(root, "Architecture.md"),
      "---\nflapstack_id: architecture\naliases: [System]\ntags: [design]\n---\n# Architecture\n",
    )
    writeFileSync(
      join(root, "Decision.md"),
      "---\nflapstack_id: decision-1\nflapstack_type: decision\n---\n# Decision\nSee [[System]].\n",
    )

    const result = await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    const graph = currentProjectVaultGraph(sqlite, "project-1")

    expect(result).toMatchObject({ noteCount: 2, edgeCount: 1 })
    expect(graph.generationId).toBe(result.generationId)
    expect(graph.nodes.map((node) => node.stableId)).toEqual(["architecture", "decision-1"])
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: "decision-1",
        targetNodeId: "architecture",
        status: "resolved",
      }),
    )
    expect(graph.backlinks("architecture")).toHaveLength(1)
  })

  it("never mixes generations and leaves the prior graph current after a failed scan", async () => {
    writeFileSync(join(root, "A.md"), "---\nflapstack_id: a\n---\n# A\n")
    const index = new ProjectVaultGraphIndex(sqlite)
    const first = await index.rebuild("project-1")
    writeFileSync(join(root, "B.md"), "---\nflapstack_id: b\n---\n# B\n[[A]]\n")
    const second = await index.rebuild("project-1")

    expect(second.generationId).not.toBe(first.generationId)
    expect(currentProjectVaultGraph(sqlite, "project-1").nodes).toHaveLength(2)
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM project_vault_graph_nodes WHERE generation_id = ?")
        .get(first.generationId),
    ).toEqual({ count: 1 })

    writeFileSync(join(root, "Too-large.md"), "x".repeat(1_048_577))
    await expect(index.rebuild("project-1")).rejects.toThrow(/size limit/)
    expect(currentProjectVaultGraph(sqlite, "project-1").generationId).toBe(second.generationId)
  })

  it("does not guess ambiguous targets and can rebuild a deleted derived index", async () => {
    mkdirSync(join(root, "one"))
    mkdirSync(join(root, "two"))
    writeFileSync(join(root, "one", "Shared.md"), "# One\n")
    writeFileSync(join(root, "two", "Shared.md"), "# Two\n")
    writeFileSync(join(root, "Source.md"), "# Source\n[[Shared]]\n")
    const index = new ProjectVaultGraphIndex(sqlite)
    const first = await index.rebuild("project-1")
    expect(currentProjectVaultGraph(sqlite, "project-1").edges).toContainEqual(
      expect.objectContaining({ status: "ambiguous", targetNodeId: null }),
    )

    sqlite.prepare("DELETE FROM project_vault_graph_state WHERE project_id = 'project-1'").run()
    sqlite
      .prepare("DELETE FROM project_vault_graph_generations WHERE project_id = 'project-1'")
      .run()
    expect(() => currentProjectVaultGraph(sqlite, "project-1")).toThrow(/not indexed/)

    const rebuilt = await index.rebuild("project-1")
    expect(rebuilt.generationId).not.toBe(first.generationId)
    expect(currentProjectVaultGraph(sqlite, "project-1").nodes).toHaveLength(3)
  })

  it("resolves heading and block links only when the referenced fragment exists", async () => {
    writeFileSync(
      join(root, "Target.md"),
      "# Target\n\n## Storage Decision\n\nA durable paragraph. ^durable-block\n",
    )
    writeFileSync(
      join(root, "Source.md"),
      [
        "# Source",
        "[[Target#Storage Decision]]",
        "[[Target#Missing Decision]]",
        "[[Target^durable-block]]",
        "[[Target^missing-block]]",
      ].join("\n"),
    )

    await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    const graph = currentProjectVaultGraph(sqlite, "project-1")

    expect(
      graph.edges.map(({ heading, blockId, status, targetNodeId }) => ({
        heading,
        blockId,
        status,
        targetNodeId,
      })),
    ).toEqual([
      {
        heading: "Storage Decision",
        blockId: null,
        status: "resolved",
        targetNodeId: expect.any(String),
      },
      {
        heading: "Missing Decision",
        blockId: null,
        status: "unresolved",
        targetNodeId: null,
      },
      {
        heading: null,
        blockId: "durable-block",
        status: "resolved",
        targetNodeId: expect.any(String),
      },
      {
        heading: null,
        blockId: "missing-block",
        status: "unresolved",
        targetNodeId: null,
      },
    ])
  })

  it("coalesces invalidation storms and publishes only the final scan", async () => {
    writeFileSync(join(root, "A.md"), "# A\n")
    const index = new ProjectVaultGraphIndex(sqlite)
    const pending = [
      index.scheduleRebuild("project-1", 5),
      index.scheduleRebuild("project-1", 5),
      index.scheduleRebuild("project-1", 5),
    ]
    const results = await Promise.all(pending)

    expect(new Set(results.map((result) => result.generationId)).size).toBe(1)
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM project_vault_graph_generations WHERE project_id = 'project-1'",
        )
        .get(),
    ).toEqual({ count: 1 })
  })

  it("watches external Obsidian-style atomic changes and publishes the final state", async () => {
    const invalidations: ProductMcpRendererInvalidation[] = []
    invalidationBridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => invalidations.push(event),
    })
    writeFileSync(join(root, "A.md"), "# A\n")
    const index = new ProjectVaultGraphIndex(sqlite)
    await index.rebuild("project-1")
    await index.startWatching("project-1")
    try {
      await vi.waitFor(() => expect(invalidations).toHaveLength(1))
      invalidations.length = 0
      writeFileSync(join(root, "B.md"), "# B\n[[A]]\n")
      await pollUntil(() => currentProjectVaultGraph(sqlite, "project-1").nodes.length === 2)
      expect(currentProjectVaultGraph(sqlite, "project-1").edges).toHaveLength(1)
      await vi.waitFor(() => expect(invalidations).toHaveLength(1))
      expect(invalidations[0]).toEqual({
        version: 1,
        source: "product-mcp",
        domains: ["vaults"],
        projectIds: ["project-1"],
      })
    } finally {
      await index.closeWatchers()
    }
  }, 20_000)

  it("retains watcher error handling for its lifetime and cleans up idempotently", async () => {
    const watchers: TestWatcher[] = []
    const reportWatcherError = vi.fn()
    const index = new ProjectVaultGraphIndex(sqlite, {
      watchFactory: () => {
        const watcher = new TestWatcher()
        watchers.push(watcher)
        queueMicrotask(() => watcher.emit("ready"))
        return watcher
      },
      reportWatcherError,
    })

    await index.startWatching("project-1")
    const first = watchers[0]!
    first.emit("error", new Error("watch failed after ready"))
    expect(reportWatcherError).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ message: "watch failed after ready" }),
    )

    await index.closeWatchers()
    await index.closeWatchers()
    expect(first.close).toHaveBeenCalledOnce()

    await index.startWatching("project-1")
    expect(watchers).toHaveLength(2)
    await index.closeWatchers()
    expect(watchers[1]!.close).toHaveBeenCalledOnce()
  })

  it("quarantines secret-bearing notes from nodes, search, and resolved edges", async () => {
    writeFileSync(
      join(root, "Secret.md"),
      "# Credentials\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n",
    )
    writeFileSync(join(root, "Source.md"), "# Source\n[[Secret]]\n")

    await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    const graph = currentProjectVaultGraph(sqlite, "project-1")

    expect(graph.nodes.map((node) => node.relativePath)).toEqual(["Source.md"])
    expect(graph.search("Credentials")).toEqual([])
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: graph.nodes[0]!.nodeId,
        targetRaw: "Secret",
        targetNodeId: null,
        status: "unresolved",
      }),
    )
  })
})

class TestWatcher extends EventEmitter {
  close = vi.fn(async () => undefined)

  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  override once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener)
  }

  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }
}

async function pollUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for project-vault graph rebuild.")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
