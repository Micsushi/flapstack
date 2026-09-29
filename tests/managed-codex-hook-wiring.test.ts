import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdirSync, mkdtempSync, writeFileSync, lstatSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname, basename } from "node:path"
import { expect, it, vi } from "vitest"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { FakeCodexProtocolClient, runtimeContext } from "./codex-runtime-test-helpers"
import {
  HookLifecycleService,
  MemoryHookStateStore,
  NodeHookDryRunRunner,
  setExtensionEnablementPolicy,
  extensionPolicyTargetFromManifest,
} from "../src/main/lib/extension-management"
import { discoverProviderExtensions } from "../src/main/lib/provider-extensions"

const boundary = vi.hoisted(() => ({
  clients: [] as FakeCodexProtocolClient[],
  claudeDependencies: null as unknown,
}))
vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))
vi.mock("../src/main/lib/claude", () => ({
  getBundledClaudeBinaryPath: () => "synthetic-claude",
  getClaudeShellEnvironment: () => ({}),
}))
// Preserve the actual launcher-owned callbacks and actual adapter. Only executable/provider I/O is replaced.
vi.mock("../src/main/lib/agent-runtime/codex", async (original) => {
  const actual = await original<typeof import("../src/main/lib/agent-runtime/codex")>()
  return {
    createCodexRuntimeAdapterFactory: (
      options: Parameters<typeof actual.createCodexRuntimeAdapterFactory>[0],
    ) =>
      actual.createCodexRuntimeAdapterFactory({
        ...options,
        resolveCommand: () => "synthetic-no-launch",
        getBinaryVersion: async () => "0.153.4",
        createClient: () => {
          const client = new FakeCodexProtocolClient()
          boundary.clients.push(client)
          return client
        },
      }),
  }
})
vi.mock("../src/main/lib/agent-runtime/claude-code", async (original) => {
  const actual = await original<typeof import("../src/main/lib/agent-runtime/claude-code")>()
  return {
    ...actual,
    createClaudeCodeRuntimeAdapter: (
      dependencies: Parameters<typeof actual.createClaudeCodeRuntimeAdapter>[0],
    ) => {
      boundary.claudeDependencies = dependencies
      return actual.createClaudeCodeRuntimeAdapter(dependencies)
    },
  }
})
import { MainRuntimeLaunchService } from "../src/main/lib/main-run-launcher"

it("carries lifecycle-approved hooks and extension policy through launcher-owned start/resume/fork parameters", async () => {
  const node =
    process.env.FLAPSTACK_TEST_NODE22 ||
    (process.versions.node.startsWith("22.") && !process.versions.electron && process.execPath)
  if (!node) throw new Error("Set FLAPSTACK_TEST_NODE22 to an installed Node22 executable")
  const directory = mkdtempSync(join(tmpdir(), "flapstack-hook-wiring-"))
  const home = join(directory, "home"),
    project = join(directory, "project"),
    path = join(directory, "agents.db")
  mkdirSync(home)
  mkdirSync(project)
  vi.stubEnv("HOME", home)
  vi.stubEnv("USERPROFILE", home)
  vi.stubEnv("CODEX_HOME", join(home, ".codex"))
  const sqlite = new Database(path)
  const db = drizzle(sqlite, { schema })
  let adapter: ReturnType<MainRuntimeLaunchService["registry"]["get"]> = null
  const contexts: ReturnType<typeof runtimeContext>[] = []
  try {
    migrateDatabase(db, sqlite, resolve("drizzle"))
    db.insert(schema.projects).values({ id: "project-1", name: "Synthetic", path: project }).run()
    db.insert(schema.chats)
      .values({
        id: "chat-1",
        name: "Synthetic",
        projectId: "project-1",
        scope: "project",
        worktreePath: project,
      })
      .run()
    const stat = lstatSync(project, { bigint: true })
    db.insert(schema.filesystemRootRegistrations)
      .values({
        path: project,
        canonicalPath: realpathSync(project),
        deviceId: String(stat.dev),
        inodeId: String(stat.ino),
        boundAt: new Date(),
      })
      .run()
    const skill = join(home, ".agents/skills/blocked/SKILL.md")
    mkdirSync(join(home, ".agents/skills/blocked"), { recursive: true })
    writeFileSync(
      skill,
      "---\nname: blocked\ndescription: Synthetic policy fixture\n---\nNo work.\n",
    )
    const installed = (await discoverProviderExtensions({ homeDir: home, cwd: project })).find(
      (e) => e.name === "blocked" && extensionPolicyTargetFromManifest(e).harness === "codex",
    )
    expect(installed).toBeDefined()
    setExtensionEnablementPolicy(db, {
      target: extensionPolicyTargetFromManifest(installed!),
      location: { type: "user" },
      enabled: false,
    })
    const script = join(directory, "dry-run.cjs")
    writeFileSync(
      script,
      "if(process.env.FLAPSTACK_HOOK_DRY_RUN!=='1')process.exit(9);process.stdout.write('{}')",
    )
    const store = new MemoryHookStateStore()
    const lifecycle = new HookLifecycleService(
      store,
      new NodeHookDryRunRunner(),
      { request: async () => "approved" },
      { append: () => {} },
      (cwd) => realpathSync(cwd),
    )
    const imported = await lifecycle.import({
      name: "Synthetic hook",
      harness: "codex",
      scope: "project",
      cwd: project,
      event: "SessionStart",
      command: `"${node}" "${script}"`,
      timeoutMs: 5000,
    })
    expect(imported.enabled).toBe(false)
    const service = new MainRuntimeLaunchService({
      databasePath: path,
      hookStore: store,
      enableCodex: true,
    })
    adapter = service.registry.get("codex", "codex")!
    const session = { providerThreadId: "thread-1", providerSessionId: "session-1" }
    async function request(
      operation: "start" | "resume" | "fork",
      enabled: boolean,
      requestedPreference: ReturnType<
        typeof runtimeContext
      >["launch"]["requestedPreference"] = "codex-enhanced",
      expectExtensionPolicy = true,
    ) {
      const context = runtimeContext()
      context.runId = `hook-${operation}-${contexts.length}`
      context.launch.requestedPreference = requestedPreference
      contexts.push(context)
      sqlite
        .prepare(
          "INSERT INTO agent_runs(id,chat_id,harness,worktree_path,permission_mode,initial_prompt,status,started_at,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES(?,'chat-1','codex',?,'read-only','Synthetic wiring only','running',1,?,?,?,?,?,?,?,?)",
        )
        .run(context.runId, project, ...testRuntimeSnapshotSqlValues("codex"))
      if (operation === "start") await adapter!.startSession(context)
      else if (operation === "resume") await adapter!.resumeSession(context, session)
      else await adapter!.forkSession(context, session, "turn-parent")
      const params = boundary.clients
        .at(-1)!
        .requests.find((r) => r.method === `thread/${operation}`)!.params!
      expect(params.cwd).toBe(realpathSync(project))
      if (!expectExtensionPolicy) {
        expect(params).not.toHaveProperty("config")
      } else {
        expect(params.config).toMatchObject({
          skills: { config: [{ path: installed!.sourceId, enabled: false }] },
        })
      }
      if (enabled && expectExtensionPolicy)
        expect(params.config).toMatchObject({
          features: { hooks: true },
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: imported.definition.command, timeout: 5 }] },
            ],
          },
        })
      else if (expectExtensionPolicy) expect(params.config).not.toHaveProperty("hooks")
      expect(boundary.clients.at(-1)!.requests.some((r) => r.method === "turn/start")).toBe(false)
      await adapter!.cleanup(context)
    }
    await request("start", false, "codex")
    expect((await lifecycle.validate(imported.id)).validation?.valid).toBe(true)
    expect((await lifecycle.dryRun(imported.id)).dryRun?.success).toBe(true)
    await lifecycle.setEnabled(imported.id, true)
    for (const operation of ["start", "resume", "fork"] as const) await request(operation, true)
    await lifecycle.setEnabled(imported.id, false)
    await request("resume", false)
    vi.stubEnv("FLAPSTACK_PREVIEW_HEADLESS", "1")
    await request("start", false, "codex", false)
  } finally {
    for (const context of contexts) await adapter?.cleanup(context)
    sqlite.close()
    vi.unstubAllEnvs()
    expect(boundary.clients.every((c) => c.closed)).toBe(true)
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
    expect(basename(directory).startsWith("flapstack-hook-wiring-")).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  }
}, 20000)

it("applies Claude extension policy to ordinary launches and isolates hidden Preview options", async () => {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-claude-policy-wiring-"))
  const project = join(directory, "project")
  const home = join(directory, "empty-home")
  const path = join(directory, "agents.db")
  mkdirSync(project)
  mkdirSync(home)
  const sqlite = new Database(path)
  const database = drizzle(sqlite, { schema })
  try {
    boundary.claudeDependencies = null
    migrateDatabase(database, sqlite, resolve("drizzle"))
    database
      .insert(schema.projects)
      .values({ id: "project-1", name: "Synthetic", path: project })
      .run()
    database
      .insert(schema.tasks)
      .values({ id: "task-1", projectId: "project-1", name: "Task" })
      .run()
    database
      .insert(schema.chats)
      .values({
        id: "chat-1",
        name: "Synthetic",
        projectId: "project-1",
        taskId: "task-1",
        scope: "task",
        worktreePath: project,
      })
      .run()
    const stat = lstatSync(project, { bigint: true })
    database
      .insert(schema.filesystemRootRegistrations)
      .values({
        path: project,
        canonicalPath: realpathSync(project),
        deviceId: String(stat.dev),
        inodeId: String(stat.ino),
        boundAt: new Date(),
      })
      .run()
    for (const name of ["alpha", "beta"]) {
      const skill = join(project, ".claude", "skills", name, "SKILL.md")
      mkdirSync(dirname(skill), { recursive: true })
      writeFileSync(
        skill,
        `---\nname: ${name}\ndescription: Synthetic policy fixture\n---\nNo work.\n`,
      )
    }
    const inventory = await discoverProviderExtensions({ cwd: project, homeDir: home })
    const alpha = inventory.find(
      (extension) =>
        extension.provider === "claude" &&
        extension.kind === "skill" &&
        extension.name === "alpha" &&
        extension.source === "project",
    )
    expect(alpha).toBeDefined()
    setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(alpha!),
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })
    sqlite
      .prepare(
        "INSERT INTO agent_runs(id,chat_id,harness,worktree_path,permission_mode,initial_prompt,status,started_at,runtime_snapshot_version,runtime_preference,runtime_preference_source,resolved_runtime,runtime_adapter_version,runtime_protocol_version,runtime_capability_snapshot,runtime_control_snapshot) VALUES('claude-policy','chat-1','claude-code',?,'read-only','Synthetic wiring only','running',1,?,?,?,?,?,?,?,?)",
      )
      .run(project, ...testRuntimeSnapshotSqlValues("claude-code", "claude-code"))

    const service = new MainRuntimeLaunchService({
      databasePath: path,
      enableClaudeCode: true,
    })
    service.registry.get("claude-code", "claude-code")
    const dependencies = boundary.claudeDependencies as {
      buildQueryOptions(
        context: ReturnType<typeof runtimeContext>,
        prompt: string,
        abortController: AbortController,
      ): Promise<Record<string, unknown>>
    }
    const context = runtimeContext()
    context.runId = "claude-policy"
    context.chatId = "chat-1"
    context.subChatId = null
    context.launch = {
      ...context.launch,
      harness: "claude-code",
      model: "claude-opus-5-5",
      requestedPreference: "claude-code",
      resolvedRuntime: "claude-code",
      compatibility: {
        compatible: true,
        harness: "claude-code",
        runtime: "claude-code",
        reason: null,
      },
      versions: { adapterVersion: "1", protocolVersion: "claude-agent-sdk/0.3.207" },
    }

    vi.stubEnv("FLAPSTACK_PREVIEW_HEADLESS", "")
    const ordinary = await dependencies.buildQueryOptions(context, "Prompt", new AbortController())
    expect(ordinary.settingSources).toEqual(["user", "project", "local"])
    expect(ordinary.skills).toContain("beta")
    expect(ordinary.skills).not.toContain("alpha")

    vi.stubEnv("FLAPSTACK_PREVIEW_HEADLESS", "1")
    const hidden = await dependencies.buildQueryOptions(context, "Prompt", new AbortController())
    expect(hidden).toMatchObject({
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
    })
    expect(hidden).not.toHaveProperty("skills")
    expect(hidden).not.toHaveProperty("hooks")
  } finally {
    sqlite.close()
    vi.unstubAllEnvs()
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
    expect(basename(directory).startsWith("flapstack-claude-policy-wiring-")).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  }
}, 20000)
