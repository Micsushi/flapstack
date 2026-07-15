import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { appendMcpAuditRecord } from "../src/main/lib/mcp-control/audit-storage"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { createMcpProjectVaultService } from "../src/main/lib/mcp-control/project-vault-service"
import { getMcpControlTool, invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { scaffoldProjectVault } from "../src/main/lib/project-vaults/storage"

describe("approved MCP project vault operations", () => {
  let directory: string
  let databasePath: string
  let sqlite: Database.Database
  let database: ReturnType<typeof drizzle<typeof schema>>
  let vaultRoot: string

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-vault-"))
    databasePath = join(directory, "agents.db")
    sqlite = new Database(databasePath)
    sqlite.pragma("foreign_keys = ON")
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })

    const appDataRoot = join(directory, "app-data")
    const projectOneRoot = join(directory, "project-1")
    const projectTwoRoot = join(directory, "project-2")
    mkdirSync(appDataRoot)
    mkdirSync(projectOneRoot)
    mkdirSync(projectTwoRoot)
    database
      .insert(schema.projects)
      .values([
        { id: "project-1", name: "One", path: projectOneRoot },
        { id: "project-2", name: "Two", path: projectTwoRoot },
      ])
      .run()
    database
      .insert(schema.tasks)
      .values({ id: "task-1", projectId: "project-1", name: "Task" })
      .run()
    database
      .insert(schema.chats)
      .values([
        {
          id: "project-caller",
          name: "Project caller",
          scope: "project",
          projectId: "project-1",
          permissionMode: "ask-before-edits",
        },
        {
          id: "task-caller",
          name: "Task caller",
          scope: "task",
          projectId: "project-2",
          taskId: "task-1",
          permissionMode: "full-access",
        },
        {
          id: "global-caller",
          name: "Global caller",
          scope: "global",
          permissionMode: "full-access",
        },
      ])
      .run()
    vaultRoot = (
      await scaffoldProjectVault(database, {
        projectId: "project-1",
        appDataRoot,
        sections: ["index", "handoff", "decisions"],
      })
    ).vault.rootPath
    await scaffoldProjectVault(database, {
      projectId: "project-2",
      appDataRoot,
      sections: ["index"],
    })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("registers bounded tools at the Stage 3 read/write tiers", () => {
    expect(getMcpControlTool("list_vault_sections")).toMatchObject({
      tier: 0,
      status: "implemented",
    })
    expect(getMcpControlTool("read_vault_section")).toMatchObject({
      tier: 0,
      status: "implemented",
    })
    for (const name of [
      "create_vault_section",
      "update_vault_section",
      "update_vault_handoff",
      "record_vault_decision",
    ]) {
      expect(getMcpControlTool(name)).toMatchObject({
        tier: 2,
        requiredCapabilities: ["projectWrite"],
        status: "implemented",
      })
    }
  })

  it("limits reads to caller scope and never accepts filesystem targets", async () => {
    const service = createMcpProjectVaultService(databasePath)
    const caller = { chatId: "project-caller", permissionMode: "full-access" as const }
    const listed = await service.invoke("list_vault_sections", caller, {
      projectId: "project-1",
    })
    expect(listed).toMatchObject({ ok: true })
    expect(listed.ok && (listed.data as { sections: unknown[] }).sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ sectionId: "index", version: 1 })]),
    )
    await expect(
      service.invoke("read_vault_section", caller, {
        projectId: "project-2",
        sectionId: "index",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "out-of-scope" } })
    await expect(
      service.invoke(
        "read_vault_section",
        { chatId: "task-caller", permissionMode: "full-access" },
        { projectId: "project-1", sectionId: "index" },
      ),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      service.invoke(
        "read_vault_section",
        { chatId: "task-caller", permissionMode: "full-access" },
        { projectId: "project-2", sectionId: "index" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "out-of-scope" } })
    await expect(
      service.invoke("update_vault_section", caller, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        content: "safe",
        path: join(directory, "escape.md"),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } })
    await expect(
      service.invoke("update_vault_section", caller, {
        projectId: "project-2",
        sectionId: "index",
        expectedVersion: 1,
        content: "scope escape",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "out-of-scope" } })

    await expect(
      service.invoke(
        "read_vault_section",
        { chatId: "global-caller", permissionMode: "full-access" },
        { projectId: "project-2", sectionId: "index" },
      ),
    ).resolves.toMatchObject({ ok: true })
  })

  it("requires approval, exact versions, and emits content-free audit records", async () => {
    const approvals = new McpApprovalLifecycle()
    const invocationId = "vault-handoff-invocation"
    const pending = invokeMcpControlTool(
      "update_vault_handoff",
      { chatId: "project-caller", permissionMode: "ask-before-edits" },
      {
        projectId: "project-1",
        sectionId: "handoff",
        expectedVersion: 1,
        content: "# Updated handoff\n\nDo the next bounded step.",
      },
      undefined,
      {
        approvals,
        approvalId: () => "vault-handoff-approval",
        invocationId: () => invocationId,
        projectVaults: createMcpProjectVaultService(databasePath),
        audit: { append: (record) => appendMcpAuditRecord(database, record) },
      },
    )
    expect(approvals.listPending()).toHaveLength(1)
    approvals.approve("vault-handoff-approval")
    await expect(pending).resolves.toMatchObject({ ok: true, data: { version: 2 } })

    await expect(
      createMcpProjectVaultService(databasePath).invoke(
        "update_vault_handoff",
        { chatId: "project-caller", permissionMode: "full-access" },
        {
          projectId: "project-1",
          sectionId: "handoff",
          expectedVersion: 1,
          content: "stale overwrite",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "conflict" } })

    const rows = sqlite
      .prepare(
        "SELECT status, input_summary FROM mcp_audit_records WHERE invocation_id = ? ORDER BY created_at, id",
      )
      .all(invocationId) as Array<{ status: string; input_summary: string }>
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(["approval-required", "allowed", "dispatch-started", "completed"]),
    )
    expect(JSON.stringify(rows)).not.toContain("Do the next bounded step")
    expect(rows.at(-1)?.input_summary).toContain("sha256")
    approvals.shutdown()
  })

  it("creates only confirmed-missing sections and bounds decision helpers", async () => {
    const service = createMcpProjectVaultService(databasePath)
    const caller = { chatId: "project-caller", permissionMode: "full-access" as const }
    const createInput = {
      projectId: "project-1",
      sectionId: "context",
      expectedVersion: 0,
      content: "# Durable Context\n\nSafe context.",
    }
    await expect(
      service.invoke("create_vault_section", caller, createInput),
    ).resolves.toMatchObject({
      ok: true,
      data: { sectionId: "context", version: 1, created: true },
    })
    await expect(
      service.invoke("create_vault_section", caller, createInput),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "conflict" },
    })
    await expect(
      service.invoke("record_vault_decision", caller, {
        projectId: "project-1",
        sectionId: "decisions",
        expectedVersion: 1,
        title: "Keep vault writes bounded",
        decision: "Agents address registry sections only.",
        rationale: "Arbitrary files are outside the contract.",
      }),
    ).resolves.toMatchObject({ ok: true, data: { sectionId: "decisions", version: 2 } })
    await expect(
      service.invoke("read_vault_section", caller, {
        projectId: "project-1",
        sectionId: "decisions",
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { content: expect.stringContaining("Keep vault writes bounded") },
    })
  })

  it("fails secret writes and externally injected secret reads closed with redacted audit", async () => {
    const secret = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"
    const invocationId = "vault-secret-invocation"
    const response = await invokeMcpControlTool(
      "update_vault_section",
      { chatId: "global-caller", permissionMode: "full-access" },
      {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        content: secret,
      },
      undefined,
      {
        invocationId: () => invocationId,
        projectVaults: createMcpProjectVaultService(databasePath),
        audit: { append: (record) => appendMcpAuditRecord(database, record) },
      },
    )
    expect(response).toMatchObject({ ok: false, error: { code: "secret-detected" } })
    const storedAudit = sqlite
      .prepare(
        "SELECT input_summary, result_summary FROM mcp_audit_records WHERE invocation_id = ?",
      )
      .all(invocationId)
    expect(JSON.stringify(storedAudit)).not.toContain(secret)
    expect(JSON.stringify(storedAudit)).not.toContain("abcdefghijklmnopqrstuvwxyz123456")

    writeFileSync(join(vaultRoot, "index.md"), secret)
    await expect(
      createMcpProjectVaultService(databasePath).invoke(
        "read_vault_section",
        { chatId: "project-caller", permissionMode: "full-access" },
        { projectId: "project-1", sectionId: "index" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "secret-detected" } })
  })
})
