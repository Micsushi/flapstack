import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { closeDatabase, getDatabase, projectVaultPolicies } from "../src/main/lib/db"
import { bindRegisteredFilesystemRoot } from "../src/main/lib/git/security/path-validation"
import { createUsageBudget } from "../src/main/lib/usage/budgets"
import { AutomationControlService } from "../src/main/lib/automation/control-service"
import {
  failNextStage4CleanupForTests,
  extractRealOllamaPersistedMetadata,
  getStage4OperationalRegistryForTests,
  getStage4OperationalState,
  mutateStage4OperationalState,
  redactStage4Automation,
  redactStage4ErrorMessage,
  redactStage4PrivateSync,
  redactStage4Skill,
  redactStage4UsageBudget,
  redactStage4VaultPolicy,
  redactStage4Workspace,
  registerStage4TestProject,
  resetStage4OperationalFixturesForTests,
  resetStage4OperationalMemoryForTests,
  runPortabilityLifecycleJob,
  runStage4PortabilityFixtureForTests,
  summarizeRealOllamaUsageEvidence,
  STAGE4_OPERATIONAL_ACTIONS,
  validateRealOllamaFixtureInput,
  writeStage4RegistryAtomically,
} from "../src/main/lib/mcp-test-control/stage4-operations"
import { sanitizeStage4ControlBoundary } from "../src/main/lib/mcp-test-control/stage4-boundary"
import { devMcpExposedToolNames } from "../src/main/lib/mcp-test-control/registry"

const defaultProfileRoot = join(tmpdir(), `flapstack-stage4-test-default-profile-${process.pid}`)
process.env.FLAPSTACK_STAGE4_TEST_DEFAULT_PROFILE = defaultProfileRoot

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) =>
      name === "temp"
        ? process.env.FLAPSTACK_STAGE4_TEST_TEMP ||
          process.env.FLAPSTACK_CONFIG_DIR ||
          process.env.FLAPSTACK_STAGE4_TEST_DEFAULT_PROFILE
        : process.env.FLAPSTACK_CONFIG_DIR || process.env.FLAPSTACK_STAGE4_TEST_DEFAULT_PROFILE,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
}))
vi.mock("../src/main/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/constants")>()),
  IS_DEV: true,
}))

let fixtureRoot: string | null = null

afterAll(() => {
  rmSync(defaultProfileRoot, { recursive: true, force: true })
  delete process.env.FLAPSTACK_STAGE4_TEST_DEFAULT_PROFILE
})

afterEach(async () => {
  await resetStage4OperationalFixturesForTests()
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_CONFIG_DIR
  delete process.env.FLAPSTACK_STAGE4_TEST_TEMP
  delete process.env.ELECTRON_RENDERER_URL
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = null
})

describe("Stage 4 operational MCP control", () => {
  it("persists portability lifecycle status before and after restart-capable work", async () => {
    const job = {
      jobId: "11111111-1111-4111-8111-111111111111",
      projectId: "project-1",
      ownerPid: process.pid,
      status: "scheduled" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const persisted: string[] = []
    await runPortabilityLifecycleJob(
      job,
      async () => ({
        exported: true,
        planned: true,
        confirmed: true,
        applied: true,
        restored: true,
        cleaned: true,
      }),
      () => persisted.push(job.status),
    )
    expect(persisted).toEqual(["running", "completed"])
    expect(job).toMatchObject({ status: "completed", result: { restored: true } })

    const failedJob = { ...job, status: "scheduled" as const, result: undefined }
    const failedPersisted: string[] = []
    await runPortabilityLifecycleJob(
      failedJob,
      async () => {
        throw new Error("C:\\secret\\fixture failed")
      },
      () => failedPersisted.push(failedJob.status),
    )
    expect(failedPersisted).toEqual(["running", "failed"])
    expect(failedJob).toMatchObject({ status: "failed" })
    expect(failedJob.error).not.toContain("C:\\secret")
  })

  it("exposes only closed-world, fixture-owned mutation actions", () => {
    expect(devMcpExposedToolNames).toEqual(
      expect.arrayContaining(["get_stage4_operational_state", "mutate_stage4_operational_state"]),
    )
    expect(STAGE4_OPERATIONAL_ACTIONS).toEqual([
      "enable-stage4-beta-fixtures",
      "restore-stage4-beta-fixtures",
      "cleanup-all-owned-fixtures",
      "create-project-skill-fixture",
      "exercise-skills-hooks-fixture",
      "cleanup-project-skill-fixture",
      "create-project-vault-fixture",
      "write-project-vault-fixture",
      "cleanup-project-vault-fixture",
      "create-workspace-fixture",
      "mutate-workspace-fixture",
      "cleanup-workspace-fixture",
      "create-automation-fixture",
      "mutate-automation-fixture",
      "cleanup-automation-fixture",
      "refresh-local-model-fixture",
      "exercise-real-ollama-fixture",
      "create-usage-budget-fixture",
      "cleanup-usage-budget-fixture",
      "start-portability-lifecycle-fixture",
      "get-portability-lifecycle-fixture",
      "cleanup-portability-lifecycle-fixture",
      "create-plan-fixture",
      "exercise-plan-fixture",
      "cleanup-plan-fixture",
    ])
    expect(STAGE4_OPERATIONAL_ACTIONS.join(" ")).not.toMatch(
      /fire|private-sync|push|pull|commit|delete-workspace|delete-project-vault/,
    )
  })

  it("keeps real Ollama exercise opt-in and loopback-only", () => {
    expect(() =>
      validateRealOllamaFixtureInput(
        {
          projectId: "project-1",
          endpoint: "http://127.0.0.1:11434",
          model: "gemma3:4b",
        },
        {},
      ),
    ).toThrow("FLAPSTACK_STAGE4_REAL_OLLAMA=1")

    expect(() =>
      validateRealOllamaFixtureInput(
        {
          projectId: "project-1",
          endpoint: "https://ollama.example.test",
          model: "gemma3:4b",
        },
        { FLAPSTACK_STAGE4_REAL_OLLAMA: "1" },
      ),
    ).toThrow(/loopback/i)

    expect(
      validateRealOllamaFixtureInput(
        {
          projectId: "project-1",
          endpoint: "http://localhost:11434/",
          model: "gemma3:4b",
        },
        { FLAPSTACK_STAGE4_REAL_OLLAMA: "1" },
      ),
    ).toEqual({
      projectId: "project-1",
      endpoint: "http://localhost:11434",
      model: "gemma3:4b",
    })
  })

  it("reads no-cloud-fallback evidence from the assistant rather than the preceding user message", () => {
    expect(
      extractRealOllamaPersistedMetadata(
        [
          {
            role: "user",
            metadata: { runId: "run-1" },
          },
          {
            role: "assistant",
            metadata: {
              runId: "run-1",
              localModel: {
                harness: "local",
                model: { modelId: "gemma3:4b" },
                fallback: {
                  mode: "none",
                  cloudAllowed: false,
                  reason: "cloud-fallback-disabled",
                },
              },
            },
          },
        ],
        "run-1",
      ),
    ).toEqual({
      harness: "local",
      modelId: "gemma3:4b",
      fallback: {
        mode: "none",
        cloudAllowed: false,
        reason: "cloud-fallback-disabled",
      },
    })
  })

  it("returns numeric local usage proof without crossing the token-key redaction boundary", () => {
    const evidence = summarizeRealOllamaUsageEvidence({
      providerId: "local",
      model: "gemma3:4b",
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      costUsd: 0,
      costQuality: "exact",
    })

    expect(sanitizeStage4ControlBoundary({ usage: evidence })).toEqual({
      usage: {
        providerId: "local",
        model: "gemma3:4b",
        inputUsageRecorded: true,
        outputUsageRecorded: true,
        totalUsageRecorded: true,
        costUsd: 0,
        costQuality: "exact",
      },
    })
    expect(sanitizeStage4ControlBoundary({ usage: { totalTokens: 17 } })).toEqual({
      usage: { totalTokens: "[redacted]" },
    })
  })

  it("redacts bodies, paths, remotes, account tags, and thrown secrets", () => {
    expect(
      redactStage4Skill({
        name: "review",
        description: "Review changes",
        source: "project",
        path: "C:\\secret\\repo\\.claude\\skills\\review\\SKILL.md",
        content: "token=never-return-this",
      }),
    ).toEqual({
      name: "review",
      description: "Review changes",
      source: "project",
      pluginName: null,
      pathHint: expect.stringMatching(/^\[path:file\.md:[a-f0-9]{12}\]$/),
    })
    expect(
      redactStage4Workspace({
        id: "workspace-1",
        name: "Workspace",
        version: 2,
        owner: { kind: "manual" },
        scope: { type: "project", projectId: "project-1" },
        layout: { private: "never-return-this" },
        archivedAt: null,
      }),
    ).toEqual({
      id: "workspace-1",
      name: "Workspace",
      version: 2,
      ownerKind: "manual",
      scopeType: "project",
      archived: false,
      paneCount: 0,
      bindingTypes: [],
      rosterCount: 0,
    })
    expect(
      redactStage4Automation({
        id: "automation-1",
        state: "paused",
        enabled: false,
        version: 3,
        approval: { state: "approved" },
        draft: {
          name: "Private automation",
          scope: { type: "project" },
          action: { type: "create-chat-run" },
          trigger: { type: "manual" },
          run: { prompt: "never-return-this", harness: "codex" },
        },
      }),
    ).toMatchObject({
      id: "automation-1",
      state: "paused",
      approvalState: "approved",
      harness: "codex",
    })
    const privateSync = redactStage4PrivateSync({
      repoPath: "C:\\secret\\sync-repo",
      remote: "ssh://user@example.test/private.git",
      branch: "main",
      scopes: ["settings"],
    })
    expect(privateSync).toMatchObject({
      linked: true,
      remoteConfigured: true,
      repoPathHint: expect.stringMatching(/^\[path:directory:[a-f0-9]{12}\]$/),
    })
    expect(JSON.stringify(privateSync)).not.toContain("user@")
    expect(JSON.stringify(privateSync)).not.toContain("example.test")
    expect(JSON.stringify(privateSync)).not.toContain("sync-repo")
    const budget = redactStage4UsageBudget({
      id: "budget-1",
      scope: { type: "provider-account", providerId: "openrouter", accountTag: "private-user" },
    })
    expect(budget.scope.accountTagFingerprint).toMatch(/^[a-f0-9]{12}$/)
    expect(JSON.stringify(budget)).not.toContain("private-user")
    expect(
      redactStage4VaultPolicy({
        projectId: "project-1",
        vaultPath: "C:\\secret\\vault",
      }),
    ).toMatchObject({
      rootPathHint: expect.stringMatching(/^\[path:directory:[a-f0-9]{12}\]$/),
      rootFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
    })
    expect(
      JSON.stringify(
        redactStage4Skill({
          name: "windows",
          path: "C:\\Users\\name\\Private Leaf\\secret-name.md",
        }),
      ),
    ).not.toContain("secret-name")
    expect(
      JSON.stringify(
        redactStage4VaultPolicy({
          rootPath: "\\\\private-server\\hidden-share\\vault-leaf",
        }),
      ),
    ).not.toMatch(/private-server|hidden-share|vault-leaf/)
    expect(
      JSON.stringify(
        redactStage4PrivateSync({
          repoPath: "/home/private-user/hidden-repo",
          remote: "ssh://private-host/private.git",
        }),
      ),
    ).not.toMatch(/private-user|hidden-repo|private-host/)
    const error = redactStage4ErrorMessage(
      "Failed at C:\\Users\\name\\private\\file.json with Bearer abc.def and sk-secret123456",
    )
    expect(error).not.toContain("Users")
    expect(error).not.toContain("abc.def")
    expect(error).not.toContain("sk-secret")
  })

  it("rejects arbitrary records until ensure_test_project registers ownership", async () => {
    await expect(
      getStage4OperationalState({
        domain: "skills-hooks",
        projectId: "real-project",
      }),
    ).rejects.toThrow(/owned test project/i)
    await expect(
      getStage4OperationalState({
        domain: "skills-hooks",
        projectId: "real-project",
        cwd: "C:\\private\\unregistered",
      } as never),
    ).rejects.toThrow(/unrecognized key/i)
    await expect(
      mutateStage4OperationalState({
        action: "create-workspace-fixture",
        payload: { projectId: "real-project" },
      }),
    ).rejects.toThrow(/owned test project/i)
    await expect(
      mutateStage4OperationalState({
        action: "mutate-workspace-fixture",
        payload: {
          fixtureId: "00000000-0000-4000-8000-000000000001",
          operation: "archive",
        },
      }),
    ).rejects.toThrow(/owned workspace fixture/i)
  })

  it("makes fixture cleanup safe and idempotent for already-absent owned IDs", async () => {
    const absentFixtureId = "00000000-0000-4000-8000-000000000002"
    for (const action of [
      "cleanup-project-skill-fixture",
      "cleanup-project-vault-fixture",
      "cleanup-workspace-fixture",
      "cleanup-automation-fixture",
      "cleanup-usage-budget-fixture",
      "cleanup-plan-fixture",
    ] as const) {
      await expect(
        mutateStage4OperationalState({
          action,
          payload: { fixtureId: absentFixtureId },
        }),
      ).resolves.toMatchObject({ result: { fixtureId: absentFixtureId, cleaned: false } })
    }
  })

  it("cleans persisted ownership without accepting caller-retained fixture IDs", async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "flapstack-stage4-clean-all-empty-"))
    process.env.FLAPSTACK_CONFIG_DIR = fixtureRoot

    await expect(
      mutateStage4OperationalState({
        action: "cleanup-all-owned-fixtures",
        payload: { fixtureId: "00000000-0000-4000-8000-000000000003" },
      }),
    ).rejects.toThrow(/unrecognized key/i)

    await expect(
      mutateStage4OperationalState({
        action: "cleanup-all-owned-fixtures",
      }),
    ).resolves.toEqual({
      action: "cleanup-all-owned-fixtures",
      result: {
        status: "clean",
        cleaned: {
          skills: 0,
          vaults: 0,
          workspaces: 0,
          automations: 0,
          budgets: 0,
          plans: 0,
        },
        retryRequired: {
          skills: 0,
          vaults: 0,
          workspaces: 0,
          automations: 0,
          budgets: 0,
          plans: 0,
        },
        betaFlags: "not-needed",
      },
    })
  })

  it("isolates persisted ownership by Dev profile and rehydrates only that profile", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "flapstack-stage4-registry-"))
    const firstProfile = join(fixtureRoot, "first-profile")
    const secondProfile = join(fixtureRoot, "second-profile")
    const firstProject = join(fixtureRoot, "first-project")
    const secondProject = join(fixtureRoot, "second-project")
    for (const path of [firstProfile, secondProfile, firstProject, secondProject]) {
      mkdirSync(path, { recursive: true })
    }

    process.env.FLAPSTACK_CONFIG_DIR = firstProfile
    registerStage4TestProject({ projectId: "first-project", projectPath: firstProject })
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: ["first-project"],
      fixtureCount: 0,
    })

    resetStage4OperationalMemoryForTests()
    process.env.FLAPSTACK_CONFIG_DIR = secondProfile
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: [],
      fixtureCount: 0,
    })
    registerStage4TestProject({ projectId: "second-project", projectPath: secondProject })

    resetStage4OperationalMemoryForTests()
    process.env.FLAPSTACK_CONFIG_DIR = firstProfile
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: ["first-project"],
      fixtureCount: 0,
    })
    expect(existsSync(join(process.cwd(), "data", "dev-mcp", "stage4-fixtures.json"))).toBe(false)
  })

  it("atomically replaces the fixture registry and preserves the last good file on failure", () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "flapstack-stage4-atomic-registry-"))
    const target = join(fixtureRoot, "data", "dev-mcp", "stage4-fixtures.json")
    writeStage4RegistryAtomically(target, '{"version":1,"state":"original"}\n')
    expect(readFileSync(target, "utf8")).toContain('"original"')

    expect(() =>
      writeStage4RegistryAtomically(target, '{"version":1,"state":"replacement"}\n', {
        rename: () => {
          throw new Error("simulated interruption before atomic replace")
        },
      }),
    ).toThrow(/simulated interruption/)
    expect(readFileSync(target, "utf8")).toContain('"original"')
    expect(
      readdirSync(join(fixtureRoot, "data", "dev-mcp")).filter((name) => name.endsWith(".tmp")),
    ).toEqual([])

    writeStage4RegistryAtomically(target, '{"version":1,"state":"replacement"}\n')
    expect(readFileSync(target, "utf8")).toContain('"replacement"')
  })

  it("recovers every persisted owned fixture after restart and retains identity failures", async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "flapstack-stage4-restart-cleanup-"))
    const projectPath = join(fixtureRoot, "project")
    const databasePath = join(fixtureRoot, "agents.db")
    mkdirSync(projectPath, { recursive: true })
    process.env.FLAPSTACK_DB_PATH = databasePath
    process.env.FLAPSTACK_CONFIG_DIR = fixtureRoot
    process.env.FLAPSTACK_STAGE4_TEST_TEMP = fixtureRoot
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite
      .prepare(
        `INSERT INTO projects
           (id, name, path, default_permission_mode, created_at, updated_at)
         VALUES ('project-1', 'Stage 4 fixture', ?, 'read-only', 1, 1)`,
      )
      .run(projectPath)
    sqlite.close()
    bindRegisteredFilesystemRoot(projectPath)
    registerStage4TestProject({ projectId: "project-1", projectPath })

    const { getBetaFeatureSettings } = await import("../src/main/lib/beta-features/settings")
    const betaBefore = getBetaFeatureSettings()
    await mutateStage4OperationalState({ action: "enable-stage4-beta-fixtures" })
    await mutateStage4OperationalState({
      action: "create-project-skill-fixture",
      payload: { projectId: "project-1" },
    })
    await mutateStage4OperationalState({
      action: "create-project-vault-fixture",
      payload: { projectId: "project-1" },
    })
    await mutateStage4OperationalState({
      action: "create-workspace-fixture",
      payload: { projectId: "project-1" },
    })
    await mutateStage4OperationalState({
      action: "create-automation-fixture",
      payload: { projectId: "project-1" },
    })
    await mutateStage4OperationalState({
      action: "create-usage-budget-fixture",
      payload: { projectId: "project-1" },
    })
    await mutateStage4OperationalState({
      action: "create-plan-fixture",
      payload: { projectId: "project-1" },
    })

    const skillDirectory = readdirSync(join(projectPath, ".claude", "skills"), {
      withFileTypes: true,
    }).find((entry) => entry.isDirectory() && entry.name.startsWith("stage4-mcp-"))
    expect(skillDirectory).toBeDefined()
    const skillPath = join(projectPath, ".claude", "skills", skillDirectory!.name, "SKILL.md")
    const expectedSkill = readFileSync(skillPath, "utf8")

    resetStage4OperationalMemoryForTests()
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: ["project-1"],
      fixtureCount: 6,
    })
    writeFileSync(skillPath, `${expectedSkill}\nUser-owned edit must be preserved.`, "utf8")

    await expect(
      mutateStage4OperationalState({ action: "cleanup-all-owned-fixtures" }),
    ).resolves.toEqual({
      action: "cleanup-all-owned-fixtures",
      result: {
        status: "retry-required",
        cleaned: {
          skills: 0,
          vaults: 1,
          workspaces: 1,
          automations: 1,
          budgets: 1,
          plans: 1,
        },
        retryRequired: {
          skills: 1,
          vaults: 0,
          workspaces: 0,
          automations: 0,
          budgets: 0,
          plans: 0,
        },
        betaFlags: "restored",
      },
    })
    expect(readFileSync(skillPath, "utf8")).toContain("User-owned edit must be preserved.")
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: ["project-1"],
      fixtureCount: 1,
    })
    expect(getBetaFeatureSettings()).toMatchObject({
      projectMemory: betaBefore.projectMemory,
      savedWorkspaces: betaBefore.savedWorkspaces,
      automations: betaBefore.automations,
      planning: betaBefore.planning,
    })

    writeFileSync(skillPath, expectedSkill, "utf8")
    resetStage4OperationalMemoryForTests()
    await expect(
      mutateStage4OperationalState({ action: "cleanup-all-owned-fixtures" }),
    ).resolves.toMatchObject({
      result: {
        status: "clean",
        cleaned: { skills: 1 },
        retryRequired: { skills: 0 },
        betaFlags: "not-needed",
      },
    })
    expect(getStage4OperationalRegistryForTests()).toEqual({
      projectIds: [],
      fixtureCount: 0,
    })
    expect(existsSync(skillPath)).toBe(false)
  })

  it("exercises every remaining action only against process-owned fixtures", async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "flapstack-stage4-mcp-"))
    const projectPath = join(fixtureRoot, "project")
    const databasePath = join(fixtureRoot, "agents.db")
    mkdirSync(projectPath, { recursive: true })
    process.env.FLAPSTACK_DB_PATH = databasePath
    process.env.FLAPSTACK_CONFIG_DIR = fixtureRoot
    process.env.FLAPSTACK_STAGE4_TEST_TEMP = fixtureRoot
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173"
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite
      .prepare(
        `INSERT INTO projects
             (id, name, path, default_permission_mode, created_at, updated_at)
           VALUES ('project-1', 'Stage 4 fixture', ?, 'read-only', 1, 1)`,
      )
      .run(projectPath)
    sqlite.close()
    bindRegisteredFilesystemRoot(projectPath)
    registerStage4TestProject({ projectId: "project-1", projectPath })

    await mutateStage4OperationalState({ action: "enable-stage4-beta-fixtures" })

    const skill = await mutateStage4OperationalState({
      action: "create-project-skill-fixture",
      payload: { projectId: "project-1" },
    })
    const skillFixtureId = String((skill.result as Record<string, unknown>).fixtureId)
    const skillHookState = await getStage4OperationalState({
      domain: "skills-hooks",
      projectId: "project-1",
    })
    expect(skillHookState.skills.some((item) => item.name?.startsWith("stage4-mcp-"))).toBe(true)
    expect(skillHookState).toMatchObject({
      hookInventory: {
        count: 0,
        byState: {},
        byHarness: {},
        dryRunReady: 0,
        enabled: 0,
      },
      capabilities: {
        execution: "shell-free-bounded-dry-run",
        approval: "tier-3-for-dry-run-and-enable",
      },
    })
    await expect(
      mutateStage4OperationalState({
        action: "exercise-skills-hooks-fixture",
        payload: { fixtureId: skillFixtureId },
      }),
    ).resolves.toMatchObject({
      result: {
        copy: {
          exactDiff: true,
          sourcePreserved: true,
          targetCleaned: true,
        },
        hook: {
          importedDisabled: true,
          invalidEnableRejected: true,
          validatedBeforeDryRun: true,
          dryRunPassedBeforeEnable: true,
          enabledThenDisabled: true,
          stateRestored: true,
        },
        enablement: {
          user: false,
          project: true,
          task: false,
          nextRunEnforced: true,
          policiesRestored: true,
        },
      },
    })
    failNextStage4CleanupForTests("skill")
    await expect(
      mutateStage4OperationalState({
        action: "cleanup-project-skill-fixture",
        payload: { fixtureId: skillFixtureId },
      }),
    ).rejects.toThrow(/injected skill fixture cleanup failure/i)
    resetStage4OperationalMemoryForTests()
    expect(
      (
        await getStage4OperationalState({
          domain: "skills-hooks",
          projectId: "project-1",
        })
      ).skills.some((item) => item.name?.startsWith("stage4-mcp-")),
    ).toBe(true)
    await mutateStage4OperationalState({
      action: "cleanup-project-skill-fixture",
      payload: { fixtureId: skillFixtureId },
    })

    expect(getDatabase().select().from(projectVaultPolicies).all()).toHaveLength(0)
    await expect(
      getStage4OperationalState({
        domain: "project-vaults",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({ policy: null, sections: [] })
    expect(getDatabase().select().from(projectVaultPolicies).all()).toHaveLength(0)

    const vault = await mutateStage4OperationalState({
      action: "create-project-vault-fixture",
      payload: { projectId: "project-1" },
    })
    const vaultFixtureId = String((vault.result as Record<string, unknown>).fixtureId)
    await mutateStage4OperationalState({
      action: "write-project-vault-fixture",
      payload: { fixtureId: vaultFixtureId },
    }).then((result) =>
      expect(result.result, JSON.stringify(result.result)).toMatchObject({
        conflictRejected: true,
        unsafeContentRejected: true,
        backupRestored: true,
      }),
    )
    expect(
      (
        await getStage4OperationalState({
          domain: "project-vaults",
          projectId: "project-1",
        })
      ).sections.find((section) => section.sectionId === "index")?.version,
    ).toBe(3)
    await mutateStage4OperationalState({
      action: "cleanup-project-vault-fixture",
      payload: { fixtureId: vaultFixtureId },
    })

    const workspace = await mutateStage4OperationalState({
      action: "create-workspace-fixture",
      payload: { projectId: "project-1" },
    })
    const workspaceFixtureId = String((workspace.result as Record<string, unknown>).fixtureId)
    for (const operation of ["rename", "archive", "restore"] as const) {
      await mutateStage4OperationalState({
        action: "mutate-workspace-fixture",
        payload: { fixtureId: workspaceFixtureId, operation },
      })
    }
    await expect(
      mutateStage4OperationalState({
        action: "mutate-workspace-fixture",
        payload: { fixtureId: workspaceFixtureId, operation: "exercise-layout" },
      }),
    ).resolves.toMatchObject({
      result: {
        operation: "exercise-layout",
        paneCount: 2,
        bindingTypes: ["browser", "terminal"],
        corruptLayoutRejected: true,
      },
    })
    await expect(
      getStage4OperationalState({
        domain: "saved-workspaces",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({
      workspaces: [
        {
          paneCount: 2,
          bindingTypes: ["browser", "terminal"],
          rosterCount: 0,
        },
      ],
    })
    await mutateStage4OperationalState({
      action: "cleanup-workspace-fixture",
      payload: { fixtureId: workspaceFixtureId },
    })

    new AutomationControlService(databasePath).createDraft(
      { type: "user", id: "local-user" },
      {
        draft: {
          name: "Unowned user automation",
          description: "Must not be exposed by test control.",
          scope: { type: "project", projectId: "project-1" },
          action: { type: "create-chat-run", chatName: "Unowned" },
          trigger: { type: "manual" },
          run: {
            prompt: "Private user prompt",
            harness: "codex",
            permissionMode: "read-only",
            worktreeStrategy: "inherit",
          },
        },
      },
    )
    expect(
      (
        await getStage4OperationalState({
          domain: "automations",
          projectId: "project-1",
        })
      ).automations,
    ).toEqual([])

    const automation = await mutateStage4OperationalState({
      action: "create-automation-fixture",
      payload: { projectId: "project-1" },
    })
    const automationFixtureId = String((automation.result as Record<string, unknown>).fixtureId)
    for (const operation of ["approve", "resume", "dry-run", "pause"] as const) {
      const result = await mutateStage4OperationalState({
        action: "mutate-automation-fixture",
        payload: { fixtureId: automationFixtureId, operation },
      })
      if (operation === "dry-run") {
        expect(result.result).toMatchObject({
          operation: "dry-run",
          preview: {
            harness: "codex",
            scopeType: "project",
            permissionMode: "read-only",
          },
        })
      }
    }
    await expect(
      getStage4OperationalState({
        domain: "automations",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({
      capabilities: {
        triggers: expect.arrayContaining(["manual", "schedule", "run-complete", "file-change"]),
      },
      automations: [
        {
          triggerType: "manual",
          dryRun: {
            harness: "codex",
            scopeType: "project",
            permissionMode: "read-only",
          },
        },
      ],
    })
    await mutateStage4OperationalState({
      action: "cleanup-automation-fixture",
      payload: { fixtureId: automationFixtureId },
    })

    const local = await mutateStage4OperationalState({
      action: "refresh-local-model-fixture",
    })
    expect(local.result).toMatchObject({ state: "ready" })

    createUsageBudget(getDatabase(), {
      name: "Unowned user budget",
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      threshold: { type: "total-tokens", value: 500 },
      action: "soft-alert",
      reset: { type: "none" },
    })
    expect(
      (
        await getStage4OperationalState({
          domain: "usage-limits",
          projectId: "project-1",
        })
      ).budgets,
    ).toEqual([])

    const budget = await mutateStage4OperationalState({
      action: "create-usage-budget-fixture",
      payload: { projectId: "project-1" },
    })
    const budgetFixtureId = String((budget.result as Record<string, unknown>).fixtureId)
    expect(
      (
        await getStage4OperationalState({
          domain: "usage-limits",
          projectId: "project-1",
        })
      ).budgets,
    ).toHaveLength(1)
    await expect(
      getStage4OperationalState({
        domain: "usage-limits",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({
      rollup: {
        itemCount: 0,
        quality: "unknown",
      },
      insight: {
        coverage: "insufficient",
        quality: "unknown",
      },
    })
    await mutateStage4OperationalState({
      action: "cleanup-usage-budget-fixture",
      payload: { fixtureId: budgetFixtureId },
    })

    await expect(getStage4OperationalState({ domain: "portability" })).resolves.toMatchObject({
      capabilities: expect.any(Object),
      operation: {
        activeReaders: 0,
        exclusivePending: false,
        exclusiveActive: false,
      },
      privateSync: { linked: false },
    })
    await expect(runStage4PortabilityFixtureForTests("project-1")).resolves.toMatchObject({
      exported: true,
      planned: true,
      confirmed: true,
      applied: true,
      restored: true,
      cleaned: true,
    })
    const portabilityStarted = await mutateStage4OperationalState({
      action: "start-portability-lifecycle-fixture",
      payload: { projectId: "project-1" },
    })
    const portabilityJobId = String((portabilityStarted.result as Record<string, unknown>).jobId)
    let portabilityJob: Record<string, unknown> = {}
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await mutateStage4OperationalState({
        action: "get-portability-lifecycle-fixture",
        payload: { jobId: portabilityJobId },
      })
      portabilityJob = response.result as Record<string, unknown>
      if (portabilityJob.status === "completed" || portabilityJob.status === "failed") break
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    }
    expect(portabilityJob).toMatchObject({
      status: "completed",
      result: {
        exported: true,
        planned: true,
        confirmed: true,
        applied: true,
        restored: true,
        cleaned: true,
      },
    })
    await expect(
      mutateStage4OperationalState({
        action: "cleanup-portability-lifecycle-fixture",
        payload: { jobId: portabilityJobId },
      }),
    ).resolves.toMatchObject({ result: { cleaned: true } })

    const plan = await mutateStage4OperationalState({
      action: "create-plan-fixture",
      payload: { projectId: "project-1" },
    })
    const planFixtureId = String((plan.result as Record<string, unknown>).fixtureId)
    const exercised = await mutateStage4OperationalState({
      action: "exercise-plan-fixture",
      payload: { fixtureId: planFixtureId },
    })
    expect(exercised.result).toMatchObject({
      advanced: true,
      approved: 1,
      denied: 1,
    })
    await mutateStage4OperationalState({
      action: "cleanup-plan-fixture",
      payload: { fixtureId: planFixtureId },
    })

    const restored = await mutateStage4OperationalState({
      action: "restore-stage4-beta-fixtures",
    })
    expect(restored.result).toMatchObject({ restored: true })
  }, 30_000)
})
