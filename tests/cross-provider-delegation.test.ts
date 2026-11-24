import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CrossProviderDelegationError,
  CrossProviderDelegationService,
  type RuntimeDelegationLaunchPort,
} from "../src/main/lib/agent-runtime/cross-provider-delegation"
import { type QueuedAgentRun } from "../src/main/lib/run-launch-service"
import type { ResolvedAgentRuntime, RuntimeAdapterProbe } from "../src/shared/agent-runtime"
import { resetMainRuntimeLaunchServicesForTests } from "../src/main/lib/main-run-launcher"

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))
vi.mock("../src/main/lib/mcp-control/invalidation-bridge", () => ({
  publishLocalProductInvalidation: vi.fn(),
}))

class RuntimeStub implements RuntimeDelegationLaunchPort {
  launches: QueuedAgentRun[] = []
  cancellations: string[] = []
  state: "running" | "completed" | "cancelled" | "failed" | "uncertain" = "running"
  structuredOutput: unknown = { verdict: "pass" }
  reconcileAttempts = 0
  reconcileFailure: Error | null = null

  compositionProbe(harness: string, runtime: ResolvedAgentRuntime): RuntimeAdapterProbe {
    const supported = { supported: true, reason: null }
    const providerRuntime =
      harness === "codex" ? "codex" : harness === "claude-code" ? "claude-code" : "flapstack-native"
    const translated =
      (harness === "codex" && runtime === "claude-code") ||
      (harness === "claude-code" && runtime === "codex")
    return {
      runtime,
      harness,
      available: true,
      versions: { adapterVersion: "test", protocolVersion: "test" },
      capabilities: {
        schemaVersion: 1,
        status: "available",
        capturedAt: "2026-01-01T00:00:00.000Z",
        controls: {
          modelThinking: supported,
          reasoningDisplay: supported,
          subagentActivity: supported,
          hookDiagnostics: supported,
        },
        execution: {
          continuation: supported,
          delegation: supported,
          structuredOutput: supported,
          cancellation: supported,
        },
        ...(translated
          ? {
              composition: {
                runtimeMode: "translated" as const,
                providerRuntime,
                providerVersions: {
                  adapterVersion: `${providerRuntime}-test`,
                  protocolVersion: `${providerRuntime}-test`,
                },
                adapterChain: [
                  {
                    id:
                      runtime === "codex"
                        ? "claude-provider-to-codex-contract"
                        : "codex-provider-to-claude-contract",
                    version: "1",
                  },
                ],
                capabilities: {
                  continuation: "available" as const,
                  delegation: "available" as const,
                  structuredOutput: "available" as const,
                  cancellation: "available" as const,
                  toolLoop: "available" as const,
                  tools: "lossy" as const,
                  permissions: "available" as const,
                  reasoning: "lossy" as const,
                  sessionFork: "unavailable" as const,
                },
                losses: [
                  {
                    code: "native-session-identity",
                    summary: "Provider-native session identity is preserved without relabeling.",
                  },
                ],
              },
            }
          : {}),
        limitations: [],
        unavailableReason: null,
      },
      reason: null,
    }
  }

  async launch(run: QueuedAgentRun) {
    this.launches.push(run)
  }

  async reconcileRun() {
    this.reconcileAttempts += 1
    if (this.reconcileFailure) throw this.reconcileFailure
    return this.state
  }

  async cancel(runId: string) {
    this.cancellations.push(runId)
    return true
  }

  async readStructuredOutput(runId: string) {
    return {
      value: this.structuredOutput,
      activityReference: { runId, eventId: "output-event", sequence: 1 },
    }
  }
}

const roots: string[] = []

afterEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("cross-provider Runtime delegation", () => {
  it("blocks incompatible targets, authority widening, and stale worktree previews without fallback", () => {
    const fixture = createFixture("codex")
    const service = new CrossProviderDelegationService(fixture.path, new RuntimeStub())
    const incompatible = {
      sourceChatId: "source",
      targetHarness: "openrouter" as const,
      targetModel: "openrouter-model",
      preference: "codex" as const,
      requestId: "incompatible-target",
      objective: "Review.",
    }
    expect(() => service.preview(incompatible)).toThrow(/incompatible/i)

    const widening = {
      ...incompatible,
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "authority-widening",
      authorityRestrictions: {
        permissionMode: "full-access" as const,
        allowedToolTiers: ["read", "network"] as const,
      },
    }
    expect(() => service.preview(widening)).toThrowError(
      expect.objectContaining<Partial<CrossProviderDelegationError>>({
        code: "authority-widening",
      }),
    )

    const request = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "stale-preview",
      objective: "Review.",
    }
    const preview = service.preview(request)
    const db = new Database(fixture.path)
    db.prepare("UPDATE chats SET branch = 'changed-after-preview' WHERE id = 'source'").run()
    db.close()
    expect(() =>
      service.delegate({ ...request, confirmedPreviewDigest: preview.digest }),
    ).toThrowError(
      expect.objectContaining<Partial<CrossProviderDelegationError>>({
        code: "preview-mismatch",
      }),
    )
  })
})

function createFixture(sourceHarness: "codex" | "claude-code") {
  const root = mkdtempSync(join(tmpdir(), "flapstack-runtime-delegation-"))
  roots.push(root)
  const path = join(root, "flapstack.db")
  const db = new Database(path)
  migrate(drizzle(db), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  db.prepare(
    `INSERT INTO chats (
      id, name, scope, permission_mode, mcp_exposure_enabled, harness, model,
      runtime_preference, ancestor_chat_ids, branch, created_at, updated_at
    ) VALUES ('source', 'Source', 'global', 'read-only', 0, ?, 'source-model',
      ?, '[]', 'feature', 1, 1)`,
  ).run(sourceHarness, sourceHarness)
  db.prepare(
    `INSERT INTO sub_chats (
      id, chat_id, name, mode, harness, model, permission_mode, messages, created_at, updated_at
    ) VALUES ('source-conversation', 'source', 'Source', 'agent', ?, 'source-model',
      'read-only', ?, 1, 1)`,
  ).run(
    sourceHarness,
    JSON.stringify([
      { id: "visible", role: "user", parts: [{ type: "text", text: "Visible context" }] },
      {
        id: "private",
        role: "assistant",
        parts: [
          { type: "text", text: "Visible answer" },
          { type: "reasoning", text: "PRIVATE_REASONING" },
          {
            type: "tool-call",
            toolName: "fetch",
            input: { authorization: "Bearer SECRET_CREDENTIAL" },
          },
        ],
      },
    ]),
  )
  db.close()
  return { root, path }
}
