import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import {
  codexPermissionProfileApproval,
  getMainRuntimeLaunchService,
  resetMainRuntimeLaunchServicesForTests,
  resolveRuntimeTurnPrompt,
} from "../src/main/lib/main-run-launcher"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { recoverInterruptedMcpRuns, type QueuedAgentRun } from "../src/main/lib/run-launch-service"
import type {
  HarnessAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import type { AgentActivityAppend } from "../src/shared/agent-activity"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import {
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"
import { updateProjectVaultContextSelection } from "../src/main/lib/project-vaults/run-context"

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  directory = mkdtempSync(join(tmpdir(), "flapstack-runtime-main-service-"))
  path = join(directory, "agents.db")
  sqlite = new Database(path)
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
})

afterEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("process-wide Runtime launch service", () => {
  it("grants requested Codex permission profiles only after approval", () => {
    const request = {
      params: {
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    }
    expect(codexPermissionProfileApproval(request, true)).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
      strictAutoReview: true,
    })
    expect(codexPermissionProfileApproval(request, false)).toEqual({
      permissions: {},
      scope: "turn",
      strictAutoReview: true,
    })
  })

  it("leaves Native prompts raw because legacy routers apply chat mode themselves", () => {
    expect(
      resolveRuntimeTurnPrompt(
        { prompt: "Inspect this", chatMode: "review" },
        { resolvedRuntime: "flapstack-native" },
      ),
    ).toBe("Inspect this")
    expect(
      resolveRuntimeTurnPrompt(
        { prompt: "Inspect this", chatMode: "review" },
        { resolvedRuntime: "codex" },
      ),
    ).toContain("Review mode:")
  })

  it("owns one registry/coordinator and keeps real disabled factories recoverable", () => {
    const first = getMainRuntimeLaunchService(path)
    const second = getMainRuntimeLaunchService(path)

    expect(second).toBe(first)
    expect(first.diagnostics().registry).toEqual([
      expect.objectContaining({ runtime: "codex", enabled: false }),
      expect.objectContaining({ runtime: "claude-code", enabled: false }),
      expect.objectContaining({ runtime: "flapstack-native", enabled: true }),
    ])
    expect(() => first.registry.get("codex")).not.toThrow()
    expect(() => first.registry.get("claude-code")).not.toThrow()
  })

  it("persists intent, session, turn, activity, and terminal lifecycle", async () => {
    seedDirectRun("durable")
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "uncertain")
    const factory = vi.fn(() => value)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: true,
    })

    await service.launch(queued("durable"))

    expect(factory).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'durable'").get()).toEqual({
      status: "success",
    })
    expect(
      sqlite.prepare("SELECT session_id FROM sub_chats WHERE id = 'sub-durable'").get(),
    ).toEqual({ session_id: "thread-durable" })
    const events = sqlite
      .prepare(
        `SELECT kind, phase, provider_session_id, provider_thread_id, provider_turn_id
         FROM agent_activity_events WHERE run_id = 'durable' ORDER BY sequence`,
      )
      .all() as Array<Record<string, unknown>>
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "lifecycle", phase: "started" }),
        expect.objectContaining({ provider_session_id: "session-durable" }),
        expect.objectContaining({ provider_thread_id: "thread-durable" }),
        expect.objectContaining({ provider_turn_id: "turn-durable" }),
        expect.objectContaining({ kind: "status", phase: "updated" }),
        expect.objectContaining({ kind: "lifecycle", phase: "completed" }),
      ]),
    )
    await expect(service.reconcileRun("durable")).resolves.toBe("completed")
    expect(value.reconcile).not.toHaveBeenCalled()
  })

  it("resumes a second Codex turn with the durable provider thread identity", async () => {
    seedDirectRun("first-turn")
    const resumed: RuntimeAdapterSession[] = []
    const prompts: string[] = []
    const factory = vi.fn(() => {
      const adapter = directAdapter()
      adapter.resumeSession = async (_context, session) => {
        resumed.push(session)
        return session
      }
      adapter.startTurn = async (_context, _session, prompt) => {
        prompts.push(prompt)
        return { providerTurnId: "turn" }
      }
      return adapter
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: true,
    })
    await service.launch(queued("first-turn"))
    seedFollowupRun("second-turn", "first-turn")
    const followup = queued("second-turn")
    followup.chatId = "chat-first-turn"
    followup.subChatId = "sub-first-turn"
    followup.chatMode = "review"
    followup.prompt = "Follow up"

    await service.launch(followup)

    expect(resumed).toContainEqual({
      providerSessionId: null,
      providerThreadId: "thread-first-turn",
    })
    expect(prompts[1]).toContain("Review mode:")
    expect(prompts[1]).toContain("Follow up")
  })

  it("persists cancellation before provider launch authority is reserved", async () => {
    seedDirectRun("prelaunch-cancel")
    const factory = vi.fn(() => directAdapter())
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: true,
    })

    const launch = service.launch(queued("prelaunch-cancel"))
    await expect(service.cancel("prelaunch-cancel", "operator stopped")).resolves.toBe(true)
    await expect(launch).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(factory).not.toHaveBeenCalled()
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'prelaunch-cancel'").get(),
    ).toEqual({ status: "cancelled" })
  })

  it("loads selected project vault context through provider instructions", async () => {
    seedDirectRun("vault-context")
    const projectRoot = join(directory, "project")
    const appDataRoot = join(directory, "app-data")
    mkdirSync(projectRoot)
    mkdirSync(appDataRoot)
    sqlite.prepare("UPDATE projects SET path = ? WHERE id = 'project'").run(projectRoot)
    sqlite
      .prepare("UPDATE chats SET scope = 'project', worktree_path = ? WHERE id = ?")
      .run(projectRoot, "chat-vault-context")
    sqlite
      .prepare("UPDATE sub_chats SET worktree_path = ? WHERE id = ?")
      .run(projectRoot, "sub-vault-context")
    sqlite
      .prepare("UPDATE agent_runs SET worktree_path = ? WHERE id = ?")
      .run(projectRoot, "vault-context")

    const database = drizzle(sqlite, { schema })
    await scaffoldProjectVault(database, {
      projectId: "project",
      appDataRoot,
      sections: ["context", "decisions"],
    })
    await writeProjectVaultSection(database, {
      projectId: "project",
      sectionId: "context",
      expectedVersion: 1,
      content: "SELECTED DIRECT RUNTIME CONTEXT",
    })
    await writeProjectVaultSection(database, {
      projectId: "project",
      sectionId: "decisions",
      expectedVersion: 1,
      content: "UNSELECTED DIRECT RUNTIME CONTEXT",
    })
    updateProjectVaultContextSelection(database, {
      projectId: "project",
      sectionIds: ["context"],
    })

    let providerPrompt = ""
    let providerInstructions = ""
    const value = directAdapter()
    value.startTurn = vi.fn(async (context, _session, prompt) => {
      providerPrompt = prompt
      providerInstructions = context.instructions ?? ""
      return { providerTurnId: "turn-vault-context" }
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const run = queued("vault-context")
    run.runtimeLaunch!.requestedPreference = "codex-enhanced"
    run.worktreePath = projectRoot
    run.projectPath = projectRoot

    await service.launch(run)

    expect(providerPrompt).toBe("Prompt")
    expect(providerInstructions).toContain("SELECTED DIRECT RUNTIME CONTEXT")
    expect(providerInstructions).not.toContain("UNSELECTED DIRECT RUNTIME CONTEXT")
    expect(providerInstructions).not.toContain("--- USER REQUEST ---")
    const manifest = sqlite
      .prepare("SELECT vault_context_manifest manifest FROM agent_runs WHERE id = ?")
      .get("vault-context") as { manifest: string }
    expect(JSON.parse(manifest.manifest)).toMatchObject({
      status: "included",
      harness: "codex",
      selectedSectionIds: ["context"],
    })
  })

  it("keeps provider-parity Runtime free of Flapstack startup instructions", async () => {
    seedDirectRun("provider-parity")
    let providerInstructions: string | null | undefined = "not-called"
    const value = directAdapter()
    value.startTurn = vi.fn(async (context) => {
      providerInstructions = context.instructions
      return { providerTurnId: "turn-provider-parity" }
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await service.launch(queued("provider-parity"))

    expect(providerInstructions).toBeNull()
  })

  it("reads durable success after process-style service recreation without provider access", async () => {
    seedDirectRun("recreated-success")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    await service.launch(queued("recreated-success"))
    resetMainRuntimeLaunchServicesForTests()
    const factory = vi.fn(() => directAdapter())
    const recreated = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: false,
    })

    await expect(recreated.reconcileRun("recreated-success")).resolves.toBe("completed")
    expect(factory).not.toHaveBeenCalled()
  })

  it("stores each Codex-shaped yielded event once with one authoritative orchestration link", async () => {
    seedDirectRun("codex-single-authority")
    seedOrchestrationAgent("codex-single-authority")
    const value = directAdapter()
    value.streamActivity = async function* (context) {
      const events: AgentActivityAppend[] = [
        {
          provider: "openai",
          kind: "agent-text",
          phase: "delta",
          displayClass: "summary",
          privacyClass: "public",
          providerThreadId: "thread-codex-single-authority",
          providerTurnId: "turn-codex-single-authority",
          payload: { text: "first" },
        },
        {
          provider: "openai",
          kind: "status",
          phase: "updated",
          displayClass: "status",
          privacyClass: "public",
          providerThreadId: "thread-codex-single-authority",
          providerTurnId: "turn-codex-single-authority",
          payload: { message: "second", code: null },
        },
      ]
      createAgentActivityStore(sqlite).appendBatch(
        context.runId,
        events.map((event) => ({
          ...event,
          orchestrationAgentId: "agent-codex-single-authority",
        })),
      )
      yield* events
    }
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await service.launch(queued("codex-single-authority"))

    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count, COUNT(DISTINCT sequence) sequences,
             COUNT(DISTINCT orchestration_agent_id) links
           FROM agent_activity_events
           WHERE run_id = 'codex-single-authority' AND provider = 'openai'`,
        )
        .get(),
    ).toEqual({ count: 2, sequences: 2, links: 1 })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM agent_activity_events
           WHERE run_id = 'codex-single-authority'
             AND provider = 'openai'
             AND orchestration_agent_id = 'agent-codex-single-authority'`,
        )
        .get(),
    ).toEqual({ count: 2 })
  })

  it("reads frozen structured output from authoritative completed activity after restart", async () => {
    seedDirectRun("structured-output")
    let outputEvent!: ReturnType<ReturnType<typeof createAgentActivityStore>["append"]>
    const value = directAdapter()
    value.streamActivity = async function* (context) {
      const event: AgentActivityAppend = {
        provider: "openai",
        kind: "agent-text",
        phase: "completed",
        displayClass: "provider-visible",
        privacyClass: "public",
        providerEventId: "provider-output-1",
        providerThreadId: `thread-${context.runId}`,
        providerTurnId: `turn-${context.runId}`,
        providerMessageId: "message-output-1",
        payload: { text: '```json\n{"result":"ok","items":[1,2]}\n```' },
      }
      outputEvent = createAgentActivityStore(sqlite).append(context.runId, event)
      yield event
    }
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    await service.launch(queued("structured-output"))
    resetMainRuntimeLaunchServicesForTests()
    const factory = vi.fn(() => directAdapter())
    const recreated = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: false,
    })

    const output = await recreated.readStructuredOutput("structured-output")
    expect(output).toEqual({
      value: { result: "ok", items: [1, 2] },
      activityReference: {
        runId: "structured-output",
        eventId: outputEvent.eventId,
        sequence: outputEvent.sequence,
      },
    })
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output?.value)).toBe(true)
    expect(Object.isFrozen((output?.value as { items: number[] }).items)).toBe(true)
    expect(factory).not.toHaveBeenCalled()
  })

  it("fails closed for nonterminal, failed, hidden, private, and redacted output", async () => {
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    const writeLifecycle = (
      service as unknown as {
        persistLifecycle(runId: string, lifecycle: string, detail?: string | null): Promise<void>
      }
    ).persistLifecycle.bind(service)

    seedDirectRun("active-output")
    appendOutput("active-output", '{"state":"active"}')
    await expect(service.readStructuredOutput("active-output")).resolves.toBeNull()

    seedDirectRun("failed-output")
    appendOutput("failed-output", '{"state":"failed"}')
    await writeLifecycle("failed-output", "failed", "provider failed")
    await expect(service.readStructuredOutput("failed-output")).resolves.toBeNull()

    seedDirectRun("hidden-output")
    createAgentActivityStore(sqlite).append("hidden-output", {
      provider: "openai",
      kind: "provider-visible-reasoning",
      phase: "completed",
      displayClass: "provider-visible",
      privacyClass: "public",
      payload: { text: '{"secret":"reasoning"}', label: "Reasoning" },
    })
    await writeLifecycle("hidden-output", "completed")
    await expect(service.readStructuredOutput("hidden-output")).resolves.toBeNull()

    allowCorruptActivityFixture()
    for (const [runId, column, value] of [
      ["forged-terminal-provider", "provider", "openai"],
      ["forged-terminal-dedup", "dedup_key", "runtime:forged-completion"],
    ] as const) {
      seedDirectRun(runId)
      appendOutput(runId, '{"result":"forged"}')
      await writeLifecycle(runId, "completed")
      sqlite
        .prepare(
          `UPDATE agent_activity_events SET ${column} = ?
           WHERE run_id = ? AND kind = 'lifecycle' AND phase = 'completed'`,
        )
        .run(value, runId)
      await expect(service.readStructuredOutput(runId)).rejects.toThrow(
        "completion activity is not authoritative",
      )
    }

    seedDirectRun("forged-terminal-payload")
    appendOutput("forged-terminal-payload", '{"result":"forged"}')
    await writeLifecycle("forged-terminal-payload", "completed")
    sqlite
      .prepare(
        `UPDATE agent_activity_events SET payload_json = ?
         WHERE run_id = ? AND kind = 'lifecycle' AND phase = 'completed'`,
      )
      .run(
        JSON.stringify({ state: "completed", detail: null, providerCompletion: true }),
        "forged-terminal-payload",
      )
    await expect(service.readStructuredOutput("forged-terminal-payload")).rejects.toThrow(
      "completion activity is corrupt",
    )

    for (const [runId, column, value] of [
      ["private-output", "privacy_class", "sensitive"],
      ["redacted-output", "redaction_state", "redacted"],
    ] as const) {
      seedDirectRun(runId)
      const event = appendOutput(runId, '{"result":"blocked"}')
      await writeLifecycle(runId, "completed")
      sqlite
        .prepare(`UPDATE agent_activity_events SET ${column} = ? WHERE event_id = ?`)
        .run(value, event.eventId)
      await expect(service.readStructuredOutput(runId)).rejects.toThrow(
        "not public provider-visible",
      )
    }
  })

  it("rejects invalid, corrupt, deep, wide, and oversized structured JSON", async () => {
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    const writeLifecycle = (
      service as unknown as {
        persistLifecycle(runId: string, lifecycle: string, detail?: string | null): Promise<void>
      }
    ).persistLifecycle.bind(service)

    seedDirectRun("invalid-json")
    appendOutput("invalid-json", "not-json")
    await writeLifecycle("invalid-json", "completed")
    await expect(service.readStructuredOutput("invalid-json")).rejects.toThrow("not valid JSON")

    allowCorruptActivityFixture()
    seedDirectRun("corrupt-json")
    const corrupt = appendOutput("corrupt-json", '{"ok":true}')
    await writeLifecycle("corrupt-json", "completed")
    sqlite
      .prepare("UPDATE agent_activity_events SET payload_json = ? WHERE event_id = ?")
      .run('{"text":42}', corrupt.eventId)
    await expect(service.readStructuredOutput("corrupt-json")).rejects.toThrow(
      "activity is corrupt",
    )

    const tooDeep = { value: null as unknown }
    let cursor = tooDeep
    for (let index = 0; index < 8; index += 1) {
      const next = { value: null as unknown }
      cursor.value = next
      cursor = next
    }
    seedDirectRun("deep-json")
    appendOutput("deep-json", JSON.stringify(tooDeep))
    await writeLifecycle("deep-json", "completed")
    await expect(service.readStructuredOutput("deep-json")).rejects.toThrow("depth bound")

    seedDirectRun("wide-json")
    appendOutput(
      "wide-json",
      JSON.stringify(
        Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, 1])),
      ),
    )
    await writeLifecycle("wide-json", "completed")
    await expect(service.readStructuredOutput("wide-json")).rejects.toThrow("entry bound")

    seedDirectRun("oversized-json")
    const oversized = appendOutput("oversized-json", '{"ok":true}')
    await writeLifecycle("oversized-json", "completed")
    sqlite
      .prepare("UPDATE agent_activity_events SET payload_json = ? WHERE event_id = ?")
      .run(
        JSON.stringify({ text: JSON.stringify({ value: "x".repeat(4_097) }) }),
        oversized.eventId,
      )
    await expect(service.readStructuredOutput("oversized-json")).rejects.toThrow("oversized string")
  })

  it("does not call the provider when durable intent activity cannot commit", async () => {
    seedDirectRun("intent-failure")
    sqlite.exec("DROP TABLE agent_activity_events")
    const value = directAdapter()
    value.startSession = vi.fn(value.startSession)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await expect(service.launch(queued("intent-failure"))).rejects.toThrow()
    expect(value.startSession).not.toHaveBeenCalled()
  })

  it("persists the crash window identity and fails without replay", async () => {
    seedDirectRun("crash")
    const value = directAdapter()
    value.streamActivity = async function* () {
      throw new Error(
        "provider stderr Bearer secret-token from /Users/alice/private/project API_KEY=abcd",
      )
    }
    value.reconcile = vi.fn(async () => "uncertain")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await expect(service.launch(queued("crash"))).rejects.toThrow("provider stderr")
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'crash'").get()).toEqual({
      status: "failure",
    })
    const stored = JSON.stringify(
      sqlite
        .prepare(
          "SELECT provider_thread_id, provider_turn_id, payload_json FROM agent_activity_events WHERE run_id = 'crash'",
        )
        .all(),
    )
    expect(stored).toContain("thread-crash")
    expect(stored).toContain("turn-crash")
    expect(stored).not.toContain("secret-token")
    expect(stored).not.toContain("/Users/alice")
    expect(stored).not.toContain("abcd")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    await expect(service.reconcileRun("crash")).resolves.toBe("failed")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
  })

  it("reconciles a restarted direct run by persisted identity and never requeues it", async () => {
    seedDirectRun("restart")
    createAgentActivityStore(sqlite).append("restart", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart",
      providerThreadId: "thread-restart",
      providerTurnId: "turn-restart",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-identity",
    })
    const value = directAdapter()
    value.startSession = vi.fn(value.startSession)
    value.startTurn = vi.fn(value.startTurn)
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(recoverInterruptedMcpRuns(path, service)).resolves.toBe(0)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart'").get()).toEqual({
      status: "success",
    })
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.startSession).not.toHaveBeenCalled()
    expect(value.startTurn).not.toHaveBeenCalled()
  })

  it("treats a delivery pause as running after restart and never replays provider work", async () => {
    seedDirectRun("restart-paused")
    createAgentActivityStore(sqlite).append("restart-paused", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-paused",
      providerThreadId: "thread-restart-paused",
      providerTurnId: "turn-restart-paused",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-paused-identity",
    })
    createAgentActivityStore(sqlite).append("restart-paused", {
      provider: "runtime",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      payload: { state: "paused", detail: null },
    })
    const value = directAdapter()
    value.startSession = vi.fn(value.startSession)
    value.startTurn = vi.fn(value.startTurn)
    value.reconcile = vi.fn(async () => "running")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.resume("restart-paused")).resolves.toBe(false)
    await expect(service.reconcileRun("restart-paused")).resolves.toBe("running")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.startSession).not.toHaveBeenCalled()
    expect(value.startTurn).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM agent_activity_events
           WHERE run_id = 'restart-paused' AND provider = 'runtime'
             AND json_extract(payload_json, '$.state') = 'resumed'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })

  it("exposes provider-neutral reconciliation by persisted run identity", async () => {
    seedDirectRun("reconcile-by-id")
    createAgentActivityStore(sqlite).append("reconcile-by-id", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-reconcile-by-id",
      providerThreadId: "thread-reconcile-by-id",
      providerTurnId: "turn-reconcile-by-id",
      payload: { state: "turn-started", detail: null },
      dedupKey: "reconcile-by-id-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.reconcileRun("reconcile-by-id")).resolves.toBe("completed")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'reconcile-by-id'").get(),
    ).toEqual({ status: "success" })
  })

  it("reconciles an active stream from coordinator state without a second provider authority", async () => {
    seedDirectRun("active-reconcile")
    let started!: () => void
    let release!: () => void
    const streamStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const value = directAdapter()
    value.streamActivity = async function* () {
      started()
      await gate
    }
    value.reconcile = vi.fn(async () => "completed")
    value.cancel = vi.fn(async () => release())
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("active-reconcile"))
    await streamStarted

    await expect(service.reconcileRun("active-reconcile")).resolves.toBe("running")
    expect(value.reconcile).not.toHaveBeenCalled()
    await expect(service.cancel("active-reconcile", "operator")).resolves.toBe(true)
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'active-reconcile'").get(),
    ).toEqual({ status: "cancelled" })
  })

  it("fails a restarted direct run with missing identity instead of replaying it", async () => {
    seedDirectRun("missing")
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(recoverInterruptedMcpRuns(path, service)).resolves.toBe(0)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'missing'").get()).toEqual({
      status: "failure",
    })
    expect(value.reconcile).not.toHaveBeenCalled()
  })

  it("cancels a restarted direct run through persisted identity exactly once", async () => {
    seedDirectRun("restart-cancel")
    createAgentActivityStore(sqlite).append("restart-cancel", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-cancel",
      providerThreadId: "thread-restart-cancel",
      providerTurnId: "turn-restart-cancel",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-cancel-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(
      Promise.all([
        service.cancel("restart-cancel", "operator"),
        service.cancel("restart-cancel", "operator"),
      ]),
    ).resolves.toEqual([true, true])
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-cancel'").get(),
    ).toEqual({ status: "cancelled" })
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.cleanup).toHaveBeenCalledTimes(1)
    await expect(service.cancel("restart-cancel", "again")).resolves.toBe(false)
  })

  it("serializes concurrent persisted reconcile and cancel into one control sequence", async () => {
    seedDirectRun("persisted-operation-race")
    createAgentActivityStore(sqlite).append("persisted-operation-race", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-persisted-operation-race",
      providerThreadId: "thread-persisted-operation-race",
      providerTurnId: "turn-persisted-operation-race",
      payload: { state: "turn-started", detail: null },
      dedupKey: "persisted-operation-race-identity",
    })
    let reconcileStarted!: () => void
    let releaseReconcile!: () => void
    const started = new Promise<void>((resolve) => {
      reconcileStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseReconcile = resolve
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => {
      reconcileStarted()
      await gate
      return "running"
    })
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    const cancellation = service.cancel("persisted-operation-race", "operator")
    await started
    const reconciliation = service.reconcileRun("persisted-operation-race")
    releaseReconcile()

    await expect(cancellation).resolves.toBe(true)
    await expect(reconciliation).resolves.toBe("cancelled")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.cleanup).toHaveBeenCalledTimes(1)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'persisted-operation-race'").get(),
    ).toEqual({ status: "cancelled" })
    expect(
      sqlite
        .prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-persisted-operation-race'")
        .get(),
    ).toEqual({ run_status: "cancelled" })
  })

  it("keeps an unhandled restarted cancellation unacknowledged and uncertain", async () => {
    seedDirectRun("restart-uncertain")
    createAgentActivityStore(sqlite).append("restart-uncertain", {
      provider: "anthropic",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-uncertain",
      providerThreadId: null,
      providerTurnId: "turn-restart-uncertain",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-uncertain-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "uncertain")
    value.cancel = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.cancel("restart-uncertain", "operator")).resolves.toBe(false)
    expect(value.cancel).not.toHaveBeenCalled()
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-uncertain'").get(),
    ).toEqual({ status: "failure" })
  })

  it("does not acknowledge persisted cancellation when adapter cleanup fails", async () => {
    seedDirectRun("restart-cleanup-failure")
    createAgentActivityStore(sqlite).append("restart-cleanup-failure", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-cleanup-failure",
      providerThreadId: "thread-restart-cleanup-failure",
      providerTurnId: "turn-restart-cleanup-failure",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-cleanup-failure-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => {
      throw new Error("cleanup failed at /Users/alice/private API_KEY=abcd")
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.cancel("restart-cleanup-failure", "operator")).resolves.toBe(false)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-cleanup-failure'").get(),
    ).toEqual({ status: "failure" })
    const stored = JSON.stringify(
      sqlite
        .prepare(
          "SELECT payload_json FROM agent_activity_events WHERE run_id = 'restart-cleanup-failure'",
        )
        .all(),
    )
    expect(stored).not.toContain("/Users/alice")
    expect(stored).not.toContain("abcd")
  })

  it("keeps persisted cancellation terminal under cancel-versus-stream races", async () => {
    seedDirectRun("cancel")
    let started!: () => void
    let release!: () => void
    const streamStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const value = directAdapter()
    value.streamActivity = async function* () {
      started()
      await gate
    }
    value.cancel = vi.fn(async () => release())
    value.complete = vi.fn(async () => undefined)
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("cancel"))
    await streamStarted

    await expect(
      Promise.all([service.cancel("cancel", "operator"), service.cancel("cancel", "operator")]),
    ).resolves.toEqual([true, true])
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'cancel'").get()).toEqual({
      status: "cancelled",
    })
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.complete).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM agent_activity_events WHERE run_id = 'cancel' AND phase = 'completed'",
        )
        .get(),
    ).toEqual({ count: 0 })
    await expect(service.reconcileRun("cancel")).resolves.toBe("cancelled")
    expect(value.reconcile).not.toHaveBeenCalled()
  })

  it("rejects stale contradictory terminal lifecycle callbacks atomically", async () => {
    seedDirectRun("stale-after-cancel")
    seedDirectRun("stale-after-success")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    const writeLifecycle = (
      service as unknown as {
        persistLifecycle(runId: string, lifecycle: string, detail?: string | null): Promise<void>
      }
    ).persistLifecycle.bind(service)

    await writeLifecycle("stale-after-cancel", "cancelled", "winner")
    await Promise.all([
      writeLifecycle("stale-after-cancel", "completed", "stale-complete"),
      writeLifecycle("stale-after-cancel", "failed", "stale-failure"),
      writeLifecycle("stale-after-cancel", "uncertain", "stale-uncertain"),
    ])
    await writeLifecycle("stale-after-success", "completed", "winner")
    await Promise.all([
      writeLifecycle("stale-after-success", "failed", "stale-failure"),
      writeLifecycle("stale-after-success", "cancelled", "stale-cancel"),
    ])

    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = 'stale-after-cancel'`,
        )
        .get(),
    ).toEqual({ status: "cancelled", run_status: "cancelled" })
    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = 'stale-after-success'`,
        )
        .get(),
    ).toEqual({ status: "success", run_status: "success" })
    expect(
      sqlite
        .prepare(
          `SELECT phase, json_extract(payload_json, '$.state') state
           FROM agent_activity_events WHERE run_id = 'stale-after-cancel' AND kind = 'lifecycle'`,
        )
        .all(),
    ).toEqual([{ phase: "cancelled", state: "cancelled" }])
    expect(
      sqlite
        .prepare(
          `SELECT phase, json_extract(payload_json, '$.state') state
           FROM agent_activity_events WHERE run_id = 'stale-after-success' AND kind = 'lifecycle'`,
        )
        .all(),
    ).toEqual([{ phase: "completed", state: "completed" }])
  })

  it("does not let active reconcile overwrite cancellation terminal truth", async () => {
    seedDirectRun("active-reconcile-cancel-race")
    let streamStarted!: () => void
    let cancelStarted!: () => void
    let finishCancel!: () => void
    let finishStream!: () => void
    const streaming = new Promise<void>((resolve) => {
      streamStarted = resolve
    })
    const cancelling = new Promise<void>((resolve) => {
      cancelStarted = resolve
    })
    const cancelGate = new Promise<void>((resolve) => {
      finishCancel = resolve
    })
    const streamGate = new Promise<void>((resolve) => {
      finishStream = resolve
    })
    const value = directAdapter()
    value.streamActivity = async function* () {
      streamStarted()
      await streamGate
    }
    value.cancel = vi.fn(async () => {
      cancelStarted()
      await cancelGate
      finishStream()
    })
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("active-reconcile-cancel-race"))
    await streaming
    const cancellation = service.cancel("active-reconcile-cancel-race", "operator")
    await cancelling
    const reconciliation = service.reconcileRun("active-reconcile-cancel-race")
    finishCancel()

    await expect(cancellation).resolves.toBe(true)
    await expect(reconciliation).resolves.toBe("uncertain")
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(value.reconcile).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare("SELECT status FROM agent_runs WHERE id = 'active-reconcile-cancel-race'")
        .get(),
    ).toEqual({ status: "cancelled" })
    expect(
      sqlite
        .prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-active-reconcile-cancel-race'")
        .get(),
    ).toEqual({ run_status: "cancelled" })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM agent_activity_events
           WHERE run_id = 'active-reconcile-cancel-race' AND phase = 'completed'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })
})

function seedDirectRun(runId: string): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path, created_at) VALUES ('project', 'Project', '/tmp/project', 1)",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
       (id, project_id, name, scope, permission_mode, harness, model, worktree_path, runtime_preference)
       VALUES (?, 'project', 'Chat', 'global', 'read-only', 'codex', 'model', '/tmp/project', 'codex')`,
    )
    .run(`chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO sub_chats
       (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES (?, ?, 'codex', 'read-only', '/tmp/project', 'running', '[]')`,
    )
    .run(`sub-${runId}`, `chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, model, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, 'codex', 'model', 'read-only', '/tmp/project', ?, 'Prompt', 'running', 1,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      `chat-${runId}`,
      `sub-${runId}`,
      `mcp-${runId}`,
      ...testRuntimeSnapshotSqlValues("codex", "codex"),
    )
}

function seedFollowupRun(runId: string, previousRunId: string): void {
  sqlite
    .prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = ?")
    .run(`sub-${previousRunId}`)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, model, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, 'codex', 'model', 'read-only', '/tmp/project', ?, 'Follow up', 'running', 2,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      `chat-${previousRunId}`,
      `sub-${previousRunId}`,
      `mcp-${runId}`,
      ...testRuntimeSnapshotSqlValues("codex", "codex"),
    )
}

function seedOrchestrationAgent(runId: string): void {
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, 'project', ?)")
    .run(`task-${runId}`, `Task ${runId}`)
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
         task_id, initiating_chat_id, status, engine_snapshot_version,
         coordination_engine, coordination_engine_version, coordination_engine_source,
         coordination_engine_capability_snapshot, coordination_engine_provider_identity
       ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    )
    .run(`task-${runId}`, `chat-${runId}`, ...testCoordinationEngineSnapshotSqlValues())
  sqlite
    .prepare(
      `INSERT INTO orchestration_agents (id, task_id, chat_id, run_id, definition, status)
       VALUES (?, ?, ?, ?, '{}', 'active')`,
    )
    .run(`agent-${runId}`, `task-${runId}`, `chat-${runId}`, runId)
}

function appendOutput(runId: string, text: string) {
  return createAgentActivityStore(sqlite).append(runId, {
    provider: "openai",
    kind: "agent-text",
    phase: "completed",
    displayClass: "provider-visible",
    privacyClass: "public",
    payload: { text },
  })
}

function allowCorruptActivityFixture(): void {
  sqlite.pragma("ignore_check_constraints = ON")
  sqlite.pragma("recursive_triggers = OFF")
  sqlite.prepare("DROP TRIGGER agent_activity_events_append_only").run()
}

function queued(runId: string): QueuedAgentRun {
  return {
    runId,
    chatId: `chat-${runId}`,
    subChatId: `sub-${runId}`,
    harness: "codex",
    prompt: "Prompt",
    model: "model",
    reasoningEffort: "high",
    permissionMode: "read-only",
    customPermissions: null,
    worktreePath: "/tmp/project",
    projectPath: "/tmp/project",
    runtimeLaunch: {
      schemaVersion: 1,
      harness: "codex",
      model: "model",
      requestedPreference: "codex",
      preferenceSource: "chat",
      resolvedRuntime: "codex",
      compatibility: { compatible: true, harness: "codex", runtime: "codex", reason: null },
      versions: {
        adapterVersion: "codex-test-adapter",
        protocolVersion: "codex-test-protocol",
      },
      capabilities: availableProbe().capabilities,
      controls: {
        schemaVersion: 1,
        modelEffort: "high",
        modelThinking: true,
        reasoningDisplay: true,
        subagentActivity: true,
        hookDiagnostics: false,
      },
      permission: { mode: "read-only", customPermissions: null },
    },
  }
}

function directAdapter(): HarnessAdapter {
  return {
    runtime: "codex",
    probe: async () => availableProbe(),
    startSession: async (context) => ({
      providerSessionId: `session-${context.runId}`,
      providerThreadId: `thread-${context.runId}`,
    }),
    resumeSession: async (_context: RuntimeAdapterContext, session: RuntimeAdapterSession) =>
      session,
    startTurn: async (context) => ({ providerTurnId: `turn-${context.runId}` }),
    async *streamActivity(context) {
      const event: AgentActivityAppend = {
        provider: "openai",
        kind: "status",
        phase: "updated",
        displayClass: "status",
        privacyClass: "public",
        payload: { message: "working", code: null },
        dedupKey: `status-${context.runId}`,
      }
      createAgentActivityStore(sqlite).append(context.runId, event)
      yield event
    },
    requestPermission: async () => ({ decision: "deny" }),
    requestInput: async () => ({ answers: {} }),
    cancel: async () => undefined,
    complete: async () => undefined,
    reconcile: async () => "completed",
    cleanup: async () => undefined,
  }
}

function availableProbe() {
  return {
    runtime: "codex" as const,
    harness: "codex",
    available: true,
    versions: {
      adapterVersion: "codex-test-adapter",
      protocolVersion: "codex-test-protocol",
    },
    capabilities: {
      schemaVersion: 1 as const,
      status: "available" as const,
      capturedAt: "2026-07-14T00:00:00.000Z",
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}
