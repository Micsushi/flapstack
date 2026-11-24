import Database from "better-sqlite3"
import { execFileSync } from "node:child_process"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let path = ""
let projectPath = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-agent-orchestration-"))
  path = join(directory, "agents.db")
  projectPath = join(directory, "project")
  execFileSync("git", ["init", "-b", "main", projectPath])
  execFileSync("git", ["-C", projectPath, "commit", "--allow-empty", "-m", "init"])
  sqlite = new Database(path)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
    .run(projectPath)
  sqlite
    .prepare(
      `INSERT INTO chats (
        id, name, scope, project_id, permission_mode, harness, worktree_path,
        branch, initiator_chat_id, ancestor_chat_ids
      ) VALUES ('root-chat', 'Root', 'project', 'project-1', 'full-access', 'codex',
        ?, 'main', 'root-chat', '[]')`,
    )
    .run(projectPath)
})

afterEach(() => {
  vi.unstubAllEnvs()
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("durable agent task orchestration", () => {
  it("survives restart and supports pause, resume, manual stop, retry, and active replacement", () => {
    const firstService = createAgentOrchestrationService(path)
    const created = firstService.create(createInput({ maxParallelAgents: 1, count: 2 }))
    firstService.control(created.orchestration.taskId, "pause")
    const afterRestart = createAgentOrchestrationService(path)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.orchestration.status).toBe(
      "paused",
    )
    expect(afterRestart.control(created.orchestration.taskId, "resume").orchestration.status).toBe(
      "running",
    )

    const active = afterRestart
      .getOverview(created.orchestration.taskId)!
      .agents.find((agent) => agent.status === "active")!
    const replacement = afterRestart.replaceAgent(
      created.orchestration.taskId,
      active.id,
      definition("replacement"),
    )
    expect(replacement.replacedAgentId).toBe(active.id)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.aggregate.active).toBe(1)

    const stopped = afterRestart.control(created.orchestration.taskId, "stop")
    expect(stopped.orchestration).toMatchObject({ status: "stopped", stopReason: "manual-stop" })
    const failed = stopped.agents.find((agent) => agent.status === "stopped")!
    const retry = afterRestart.retryAgent(created.orchestration.taskId, failed.id)
    expect(retry.replacedAgentId).toBe(failed.id)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.orchestration.status).toBe(
      "running",
    )
  })
})

function createInput(
  options: {
    count?: number
    maxParallelAgents?: number
    stopConditions?: Record<string, number>
  } = {},
) {
  return {
    projectId: "project-1",
    task: { mode: "create" as const, name: "Finish Stage 4" },
    initiatingChatId: "root-chat",
    maxParallelAgents: options.maxParallelAgents ?? 2,
    maxDepth: 4,
    stopConditions: options.stopConditions ?? {},
    agents: Array.from({ length: options.count ?? 1 }, (_, index) => definition(`worker-${index}`)),
  }
}

function definition(role: string, overrides: Partial<ReturnType<typeof definitionBase>> = {}) {
  return { ...definitionBase(role), ...overrides }
}

function definitionBase(role: string) {
  return {
    role,
    name: role,
    prompt: `Do ${role}`,
    harness: role.includes("review") ? ("claude-code" as const) : ("codex" as const),
    model: "test-model",
    reasoningEffort: "high" as const,
    permissionMode: "full-access" as const,
    worktreeStrategy: "inherit" as const,
    dependencyAgentIds: [] as string[],
    completionCriteria: `${role} complete`,
  }
}
