import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { appendMcpAuditRecord } from "../src/main/lib/mcp-control/audit-storage"
import { createMcpProjectVaultService } from "../src/main/lib/mcp-control/project-vault-service"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
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
