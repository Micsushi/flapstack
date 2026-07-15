import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { getRuntimeDiagnostics } from "../src/main/lib/agent-runtime/diagnostics"
import { RUNTIME_RELEASE_POLICY } from "../src/main/lib/agent-runtime/release-policy"
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

  it("keeps native defaults gated until observed release evidence and documents repair", () => {
    expect(RUNTIME_RELEASE_POLICY.codex.enabledForNewLaunches).toBe(false)
    expect(RUNTIME_RELEASE_POLICY["claude-code"].enabledForNewLaunches).toBe(false)
    expect(RUNTIME_RELEASE_POLICY["flapstack-native"].enabledForNewLaunches).toBe(true)
    const guide = read("docs/agent-runtimes.md")
    expect(guide).toContain("never silently")
    expect(guide).toContain("Continue with Runtime")
    expect(guide).toContain("Private or encrypted reasoning is never reconstructed")
    expect(read("docs/stage4-full-feature-test-matrix.md")).toContain("S4-AR10")
  })

  it("wires durable activity and Runtime selection into the production renderer", () => {
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    const input = read("src/renderer/features/agents/main/chat-input-area.tsx")
    const newChat = read("src/renderer/features/agents/main/new-chat-form.tsx")
    expect(activeChat).toContain("RuntimeActivityPanel")
    expect(activeChat).toContain("agentActivity.list.useQuery")
    expect(input).toContain("continueWithRuntime")
    expect(input).toContain("RuntimeSelector")
    expect(newChat).toContain("runtimePreference")
  })
})

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}
