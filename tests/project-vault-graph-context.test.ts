import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { bindFilesystemRootIdentity } from "../src/main/lib/git/security/path-validation"
import {
  buildProjectVaultGraphContext,
  ProjectVaultGraphContextRejectedError,
} from "../src/main/lib/project-vaults/graph-context"
import { ProjectVaultGraphIndex } from "../src/main/lib/project-vaults/graph-index"
import {
  buildProjectVaultRunContext,
  persistProjectVaultContextManifest,
} from "../src/main/lib/project-vaults/run-context"
import { fileSymlinksSupported } from "./helpers/symlink-capability"

describe("project vault graph run context", () => {
  let directory = ""
  let root = ""
  let sqlite: Database.Database
  let generationId = ""

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-vault-graph-context-"))
    root = join(directory, "vault")
    mkdirSync(root)
    sqlite = new Database(join(directory, "graph.db"))
    migrate(drizzle(sqlite, { schema }), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    })
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
    writeFileSync(join(root, "A.md"), "---\nflapstack_id: a\n---\n# A\nA selected body.\n[[B]]\n")
    writeFileSync(join(root, "B.md"), "---\nflapstack_id: b\n---\n# B\nB linked body.\n[[C]]\n")
    writeFileSync(join(root, "C.md"), "---\nflapstack_id: c\n---\n# C\nC linked body.\n[[A]]\n")
    generationId = (await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")).generationId
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("loads only explicitly selected nodes when expansion is omitted", async () => {
    const result = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a"],
      expectedGenerationId: generationId,
    })

    expect(result.context).toContain("A selected body.")
    expect(result.context).not.toContain("B linked body.")
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      generationId,
      selectedNodeIds: ["a"],
      expansion: { depth: 0, direction: "outgoing", maxNodes: 1 },
      entries: [{ nodeId: "a", reason: "selected", depth: 0 }],
      traversedEdges: [],
    })
  })

  it("expands deterministically with cycle and node bounds plus exact edge provenance", async () => {
    const result = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a"],
      expectedGenerationId: generationId,
      expansion: { depth: 2, direction: "outgoing", maxNodes: 2 },
    })

    expect(result.manifest.entries.map((entry) => entry.nodeId)).toEqual(["a", "b"])
    expect(result.manifest.traversedEdges).toEqual([
      {
        sourceNodeId: "a",
        targetNodeId: "b",
        ordinal: 0,
        direction: "outgoing",
        depth: 1,
      },
    ])
    expect(result.manifest.omissions).toContainEqual({
      nodeId: "c",
      reason: "node-limit",
      discoveredFromNodeId: "b",
    })
    expect(result.context).toContain("B linked body.")
    expect(result.context).not.toContain("C linked body.")
  })

  it("supports explicit incoming expansion without traversing unresolved or implicit links", async () => {
    const result = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a"],
      expectedGenerationId: generationId,
      expansion: { depth: 1, direction: "incoming", maxNodes: 4 },
    })

    expect(result.manifest.entries.map((entry) => entry.nodeId)).toEqual(["a", "c"])
    expect(result.manifest.traversedEdges[0]).toMatchObject({
      sourceNodeId: "c",
      targetNodeId: "a",
      direction: "incoming",
      depth: 1,
    })
  })

  it("rejects stale generation and post-index content changes without injecting content", async () => {
    await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    await expect(
      buildProjectVaultGraphContext(sqlite, {
        projectId: "project-1",
        nodeIds: ["a"],
        expectedGenerationId: generationId,
      }),
    ).rejects.toMatchObject({
      manifest: { status: "rejected", rejection: { reason: "stale-generation" } },
    })

    generationId = (await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")).generationId
    writeFileSync(join(root, "A.md"), "# externally changed\n")
    const failure = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a"],
      expectedGenerationId: generationId,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ProjectVaultGraphContextRejectedError)
    expect(failure.manifest).toMatchObject({
      status: "rejected",
      rejection: { nodeId: "a", reason: "content-changed" },
    })
    expect(JSON.stringify(failure.manifest)).not.toContain("externally changed")
  })

  it.skipIf(!fileSymlinksSupported)(
    "rejects a note replaced by an outside symlink between rooted snapshot and open",
    async () => {
      const outside = join(directory, "outside.md")
      const indexedContent = readFileSync(join(root, "A.md"), "utf8")
      writeFileSync(outside, indexedContent)
      const request = {
        projectId: "project-1",
        nodeIds: ["a"],
        expectedGenerationId: generationId,
        rootedReadOptions: {
          beforeOpen: (targetPath: string) => {
            rmSync(targetPath)
            symlinkSync(outside, targetPath, "file")
          },
        },
      }

      const failure = await buildProjectVaultGraphContext(sqlite, request).catch(
        (error: unknown) => error,
      )

      expect(failure).toBeInstanceOf(ProjectVaultGraphContextRejectedError)
      expect(failure.manifest).toMatchObject({
        status: "rejected",
        rejection: { nodeId: "a", reason: "unsafe-path" },
      })
      expect(readFileSync(outside, "utf8")).toBe(indexedContent)
    },
  )

  it("rejects secret-like note content and records no content in the manifest", async () => {
    const secret = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"
    writeFileSync(join(root, "A.md"), `---\nflapstack_id: a\n---\n# A\n${secret}\n`)
    generationId = (await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")).generationId

    const failure = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a"],
      expectedGenerationId: generationId,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ProjectVaultGraphContextRejectedError)
    expect(failure.manifest).toMatchObject({
      status: "rejected",
      rejection: { nodeId: "a", reason: "node-not-found" },
    })
    expect(JSON.stringify(failure.manifest)).not.toContain(secret)
  })

  it("applies deterministic shared byte and token budgets", async () => {
    const first = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a", "b"],
      expectedGenerationId: generationId,
      budget: { maxBytes: 24, maxEstimatedTokens: 5 },
    })
    const second = await buildProjectVaultGraphContext(sqlite, {
      projectId: "project-1",
      nodeIds: ["a", "b"],
      expectedGenerationId: generationId,
      budget: { maxBytes: 24, maxEstimatedTokens: 5 },
    })

    expect(second).toEqual(first)
    expect(first.manifest.budget.includedBytes).toBeLessThanOrEqual(24)
    expect(first.manifest.budget.estimatedTokens).toBeLessThanOrEqual(5)
    expect(first.manifest.entries.some((entry) => entry.truncated)).toBe(true)
  })

  it("rejects budgets above the fixed graph-context policy", async () => {
    await expect(
      buildProjectVaultGraphContext(sqlite, {
        projectId: "project-1",
        nodeIds: ["a"],
        expectedGenerationId: generationId,
        budget: { maxBytes: 24_001, maxEstimatedTokens: 6_000 },
      }),
    ).rejects.toThrow(/byte budget/i)
    await expect(
      buildProjectVaultGraphContext(sqlite, {
        projectId: "project-1",
        nodeIds: ["a"],
        expectedGenerationId: generationId,
        budget: { maxBytes: 24_000, maxEstimatedTokens: 6_001 },
      }),
    ).rejects.toThrow(/token budget/i)
  })

  it("persists a versioned graph selection and replays the exact generation on retry", async () => {
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, scope, project_id) VALUES ('chat-1', 'Graph chat', 'project', 'project-1')",
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO agent_runs
         (id, chat_id, harness, permission_mode, vault_context_sections, status)
         VALUES ('run-1', 'chat-1', 'codex', 'read-only', NULL, 'success')`,
      )
      .run()
    const selection = {
      nodeIds: ["a"],
      expectedGenerationId: generationId,
      expansion: { depth: 1, direction: "outgoing" as const, maxNodes: 2 },
    }

    const first = await buildProjectVaultRunContext(drizzle(sqlite, { schema }), {
      chatId: "chat-1",
      runId: "run-1",
      harness: "codex",
      runSectionIds: [],
      runGraphSelection: selection,
    })
    persistProjectVaultContextManifest(drizzle(sqlite, { schema }), {
      runId: "run-1",
      manifest: first.manifest,
      runSectionIds: [],
      runGraphSelection: selection,
    })
    const stored = sqlite
      .prepare(
        "SELECT vault_context_sections selection, vault_context_manifest manifest FROM agent_runs WHERE id = 'run-1'",
      )
      .get() as { selection: string; manifest: string }
    expect(JSON.parse(stored.selection)).toMatchObject({
      schemaVersion: 2,
      sectionIds: [],
      graph: selection,
    })
    expect(JSON.parse(stored.manifest)).toMatchObject({
      schemaVersion: 2,
      graphContext: {
        generationId,
        selectedNodeIds: ["a"],
        entries: [{ nodeId: "a" }, { nodeId: "b" }],
      },
    })
    expect(stored.manifest).not.toContain("selected body")

    const replay = await buildProjectVaultRunContext(drizzle(sqlite, { schema }), {
      chatId: "chat-1",
      runId: "run-1",
      harness: "codex",
    })
    expect(replay).toEqual(first)
  })
})
