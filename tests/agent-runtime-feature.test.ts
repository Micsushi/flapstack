import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { getRuntimeDiagnostics } from "../src/main/lib/agent-runtime/diagnostics"
import {
  buildRuntimeReleasePolicy,
  RUNTIME_RELEASE_POLICY,
} from "../src/main/lib/agent-runtime/release-policy"
import {
  applyActivityMigration,
  applyRuntimeMigration,
  createLegacyRuntimeDatabase,
  seedRuntimeRun,
} from "./agent-runtime-test-db"

const FEATURE_SUITES = [
  "agent-runtime-resolver.test.ts",
  "agent-runtime-migration.test.ts",
  "agent-activity-store.test.ts",
  "codex-runtime-adapter.test.ts",
  "claude-runtime-adapter.test.ts",
  "flapstack-native-runtime.test.ts",
  "runtime-activity-component.test.tsx",
  "runtime-activity-accessibility.test.tsx",
  "agent-runtime-settings.test.ts",
  "agent-runtime-continuation.test.ts",
  "agent-runtime-registry.test.ts",
  "agent-runtime-provider-router-guard.test.ts",
  "agent-runtime-interactive-chat.test.ts",
  "agent-runtime-orchestration-bridge.test.ts",
] as const

describe("Agent Runtime feature acceptance", () => {
  let database: Database.Database | null = null
  afterEach(() => database?.close())

  it("keeps ordered migration metadata and every acceptance suite discoverable", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.find((entry) => entry.idx === 34)).toEqual(
      expect.objectContaining({ idx: 34, tag: "0034_agent_runtime" }),
    )
    expect(journal.entries.find((entry) => entry.idx === 35)).toEqual(
      expect.objectContaining({ idx: 35, tag: "0035_agent_activity" }),
    )
    const runtimeSnapshot = JSON.parse(read("drizzle/meta/0034_snapshot.json"))
    const activitySnapshot = JSON.parse(read("drizzle/meta/0035_snapshot.json"))
    expect(activitySnapshot.prevId).toBe(runtimeSnapshot.id)
    expect(runtimeSnapshot.tables).toHaveProperty("agent_runtime_defaults")
    expect(runtimeSnapshot.tables).not.toHaveProperty("agent_activity_events")
    expect(activitySnapshot.tables).toHaveProperty("agent_activity_events")
    for (const suite of FEATURE_SUITES) {
      expect(existsSync(resolve(process.cwd(), "tests", suite)), suite).toBe(true)
    }
  })

  it("returns bounded diagnostics without provider text, secrets, or raw session identity", () => {
    database = createLegacyRuntimeDatabase()
    applyRuntimeMigration(database)
    applyActivityMigration(database)
    const { runId, chatId, subChatId } = seedRuntimeRun(database)
    database.prepare("UPDATE agent_runs SET status = 'completed' WHERE id = ?").run(runId)
    database
      .prepare("UPDATE sub_chats SET session_id = 'raw-secret-session' WHERE id = ?")
      .run(subChatId)
    createAgentActivityStore(database).append(runId, {
      kind: "warning",
      phase: "failed",
      displayClass: "status",
      privacyClass: "public",
      provider: "fixture",
      payload: { message: "SECRET_PROVIDER_TEXT" },
    })
    const diagnostics = getRuntimeDiagnostics(database, chatId)
    const serialized = JSON.stringify(diagnostics)
    expect(diagnostics).toMatchObject({
      sessionIdentityClass: "provider-session-present",
      activity: { count: 1, firstSequence: 1, lastSequence: 1 },
      lastError: { kind: "warning", phase: "failed", redacted: true },
    })
    expect(serialized).not.toContain("SECRET_PROVIDER_TEXT")
    expect(serialized).not.toContain("raw-secret-session")
  })

  it("keeps production defaults gated while allowing explicit native Runtime testing", () => {
    expect(RUNTIME_RELEASE_POLICY.codex.enabledForNewLaunches).toBe(false)
    expect(RUNTIME_RELEASE_POLICY["claude-code"].enabledForNewLaunches).toBe(false)
    expect(RUNTIME_RELEASE_POLICY["flapstack-native"].enabledForNewLaunches).toBe(true)
    const testingPolicy = buildRuntimeReleasePolicy(true)
    expect(testingPolicy.codex).toMatchObject({ enabledForNewLaunches: true, reason: null })
    expect(testingPolicy["claude-code"]).toMatchObject({
      enabledForNewLaunches: true,
      reason: null,
    })
    const guide = read("docs/agent-runtimes.md")
    expect(guide).toContain("never silently")
    expect(guide).toContain("Continue with Runtime")
    expect(guide).toContain("Private or encrypted reasoning is never reconstructed")
    expect(read("docs/stage4-full-feature-test-matrix.md")).toContain("S4-AR10")
  })

  it("keeps Runtime selection while the production renderer uses normal chat UI", () => {
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    const input = read("src/renderer/features/agents/main/chat-input-area.tsx")
    const newChat = read("src/renderer/features/agents/main/new-chat-form.tsx")
    expect(activeChat).toContain("IsolatedMessagesSection")
    expect(activeChat).toContain("ToolCallComponent={AgentToolCall}")
    expect(activeChat).toContain("MessageGroupWrapper={MessageGroup}")
    expect(activeChat).toContain("mergeRuntimeSubChatMessages")
    expect(activeChat).toContain("latestAssistantUsesDirectRuntime(latestMessages)")
    expect(activeChat).not.toContain("RuntimeActivityPanel")
    expect(activeChat).not.toContain("agentActivity.list.useQuery")
    expect(input).toContain("continueWithRuntime")
    expect(input).toContain("RuntimeSelector")
    expect(newChat).toContain("runtimePreference")

    for (const surface of [input, newChat]) {
      expect(surface.indexOf("<AgentModelSelector")).toBeLessThan(
        surface.indexOf("<AgentModelTuningSelector"),
      )
    }
    expect(newChat).toContain("Target selectors - directly above input")
    for (const surface of [input, newChat]) {
      expect(surface.indexOf("<RuntimeSelector")).toBeLessThan(
        surface.indexOf("<PermissionSelector"),
      )
      expect(surface.indexOf("<PermissionSelector")).toBeLessThan(
        surface.indexOf("<AgentModeSelector"),
      )
    }
  })
})

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}
