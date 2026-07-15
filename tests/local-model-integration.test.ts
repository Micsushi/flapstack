import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import { getUsageProvider } from "../src/main/lib/usage/registry"
import { orchestrationAgentDefinitionSchema } from "../src/shared/agent-orchestration"
import { findUnavailableLocalModelTier } from "../src/shared/local-model-contract"

const base = {
  role: "Local worker",
  prompt: "Inspect the project and report the result.",
  harness: "local" as const,
  model: "qwen-local",
  permissionMode: "read-only" as const,
  worktreeStrategy: "inherit" as const,
  dependencyAgentIds: [],
  completionCriteria: "Return one bounded result.",
}

describe("local model Stage 4 integration contract", () => {
  it("fails closed when a required tool tier is absent from the capability snapshot", () => {
    expect(findUnavailableLocalModelTier(["read"], [])).toEqual({
      requiredTier: "read",
      state: null,
    })
    expect(findUnavailableLocalModelTier(["read"], [{ tier: "read", available: true }])).toBeNull()
  })
  it("accepts exact local workers with explicit capability requirements", () => {
    expect(
      orchestrationAgentDefinitionSchema.parse({
        ...base,
        localEndpoint: "http://127.0.0.1:22434",
        requiredLocalToolTiers: ["read"],
      }),
    ).toMatchObject({
      harness: "local",
      model: "qwen-local",
      localEndpoint: "http://127.0.0.1:22434",
      requiredLocalToolTiers: ["read"],
    })
  })

  it("rejects missing local model identity and local-only fields on cloud workers", () => {
    expect(() => orchestrationAgentDefinitionSchema.parse({ ...base, model: undefined })).toThrow(
      /exact model identity/i,
    )
    expect(() =>
      orchestrationAgentDefinitionSchema.parse({ ...base, provider: "openrouter" }),
    ).toThrow(/not supported by local/i)
    expect(() =>
      orchestrationAgentDefinitionSchema.parse({
        ...base,
        localEndpoint: "https://ollama.example.com",
      }),
    ).toThrow(/loopback/i)
    expect(() =>
      orchestrationAgentDefinitionSchema.parse({
        ...base,
        harness: "codex",
        model: "gpt-test",
        localEndpoint: "http://127.0.0.1:11434",
        requiredLocalToolTiers: ["read"],
      }),
    ).toThrow(/local endpoints apply only|only to local workers/i)
  })

  it("exposes local usage as run-only without daemon polling or credentials", async () => {
    const provider = getUsageProvider("local")!
    const context = {
      now: new Date("2026-07-14T00:00:00.000Z"),
      source: "app-poll" as const,
      getSecret: async () => null,
      log: () => undefined,
    }
    await expect(provider.isConfigured(context)).resolves.toBe(true)
    await expect(provider.getStatus(context)).resolves.toMatchObject({
      providerId: "local",
      status: "run-usage-only",
      configured: true,
      supportsDaemon: false,
      supportsHistorical: false,
    })
    await expect(provider.pollLatest(context)).resolves.toEqual([])
  })

  it("surfaces and acknowledges local orchestration cancellation requests", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-local-cancel-"))
    const path = join(directory, "agents.db")
    const database = new Database(path)
    try {
      database.exec(`
        CREATE TABLE agent_runs (
          id text PRIMARY KEY,
          harness text NOT NULL,
          sub_chat_id text NOT NULL,
          status text NOT NULL
        );
        CREATE TABLE orchestration_agents (
          run_id text PRIMARY KEY,
          status text NOT NULL,
          lease_owner text,
          lease_expires_at integer,
          updated_at integer NOT NULL
        );
        INSERT INTO agent_runs (id, harness, sub_chat_id, status)
        VALUES ('local-run', 'local', 'local-sub-chat', 'cancelled');
        INSERT INTO orchestration_agents (run_id, status, lease_owner, lease_expires_at, updated_at)
        VALUES ('local-run', 'stopped', NULL, NULL, 1);
      `)
      const service = createAgentOrchestrationService(path)
      expect(service.listCancellationRequests()).toEqual([
        { harness: "local", subChatId: "local-sub-chat", runId: "local-run" },
      ])
      expect(service.acknowledgeCancellationRequest("local-run")).toBe(true)
      expect(service.listCancellationRequests()).toEqual([])
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
