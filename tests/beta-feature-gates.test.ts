import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  betaFeatureForTrpcPath,
  getBetaFeatureSettings,
  isMcpInvocationBetaEnabled,
  setBetaFeatureEnabled,
} from "../src/main/lib/beta-features/settings"
import {
  invokeMcpControlTool,
  listImplementedMcpControlTools,
} from "../src/main/lib/mcp-control/registry"
import { automationsRouter } from "../src/main/lib/trpc/routers/automations"
import { projectVaultsRouter } from "../src/main/lib/trpc/routers/project-vaults"
import { savedWorkspacesRouter } from "../src/main/lib/trpc/routers/saved-workspaces"
import { spawnedAgentsRouter } from "../src/main/lib/trpc/routers/spawned-agents"
import { tasksRouter } from "../src/main/lib/trpc/routers/tasks"
import { BETA_FEATURE_REGISTRY, DEFAULT_BETA_FEATURE_SETTINGS } from "../src/shared/beta-features"

let directory = ""
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
  directory = mkdtempSync(join(tmpdir(), "flapstack-beta-gates-"))
  process.env.FLAPSTACK_CONFIG_DIR = directory
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
  else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
  rmSync(directory, { recursive: true, force: true })
})

describe("beta service gates", () => {
  it("keeps every service off until the user opts in", () => {
    expect(getBetaFeatureSettings()).toEqual(DEFAULT_BETA_FEATURE_SETTINGS)
    expect(Object.values(getBetaFeatureSettings()).every((enabled) => !enabled)).toBe(true)

    expect(setBetaFeatureEnabled("automations", true)).toMatchObject({ automations: true })
    expect(getBetaFeatureSettings()).toMatchObject({
      automations: true,
      branchesAndWorktrees: false,
      orchestration: false,
      projectMemory: false,
    })
    expect(BETA_FEATURE_REGISTRY).toContainEqual(
      expect.objectContaining({ id: "branchesAndWorktrees", label: "Branches & Worktrees" }),
    )
  })

  it("blocks disabled local service procedures", async () => {
    const context = { getWindow: () => null }
    await expect(automationsRouter.createCaller(context).getCapabilities()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    })
    await expect(
      projectVaultsRouter.createCaller(context).getSectionRegistry(),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    })
    await expect(
      tasksRouter.createCaller(context).board({ includeArchived: false }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    })
    expect(betaFeatureForTrpcPath("tasks.archive")).toBeNull()
    expect(betaFeatureForTrpcPath("tasks.create")).toBeNull()
    expect(betaFeatureForTrpcPath("tasks.board")).toBe("planning")
    expect(betaFeatureForTrpcPath("changes.getRepositoryOverview")).toBe("branchesAndWorktrees")
    await expect(
      spawnedAgentsRouter.createCaller(context).getTaskOverview({ taskId: "task" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    await expect(
      savedWorkspacesRouter.createCaller(context).list({ archive: "active" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    })

    setBetaFeatureEnabled("automations", true)
    await expect(automationsRouter.createCaller(context).getCapabilities()).resolves.toMatchObject({
      enabled: true,
    })
  })

  it("removes disabled service tools from MCP while preserving MCP and sub-agents", async () => {
    const names = listImplementedMcpControlTools().map((tool) => tool.name)
    expect(names).toContain("ping")
    expect(names).toContain("spawn_thread")
    expect(names).not.toContain("orchestrate_task")
    expect(names).not.toContain("list_automations")
    expect(names).not.toContain("list_vault_sections")
    expect(names).toContain("list_tasks")
    expect(names).toContain("create_task")

    await expect(
      invokeMcpControlTool(
        "list_automations",
        { chatId: "chat", runId: "run", permissionMode: "read-only" },
        {},
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "tool-unavailable" },
    })

    expect(isMcpInvocationBetaEnabled("rename_item", { kind: "task" })).toBe(true)
    expect(isMcpInvocationBetaEnabled("archive_item", { kind: "task" })).toBe(true)
    expect(isMcpInvocationBetaEnabled("create_chat", { scope: "task" })).toBe(true)
    expect(isMcpInvocationBetaEnabled("rename_item", { kind: "chat" })).toBe(true)
    expect(isMcpInvocationBetaEnabled("launch_run", { vaultContextSectionIds: ["context"] })).toBe(
      false,
    )

    setBetaFeatureEnabled("orchestration", true)
    expect(listImplementedMcpControlTools().map((tool) => tool.name)).toContain("orchestrate_task")
  })
})
