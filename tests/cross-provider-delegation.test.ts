import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CrossProviderDelegationError,
  CrossProviderDelegationService,
  type RuntimeDelegationLaunchPort,
} from "../src/main/lib/agent-runtime/cross-provider-delegation"
import type { QueuedAgentRun } from "../src/main/lib/run-launch-service"

class RuntimeStub implements RuntimeDelegationLaunchPort {
  launches: QueuedAgentRun[] = []
  cancellations: string[] = []
  state: "running" | "completed" | "cancelled" | "failed" | "uncertain" = "running"
  structuredOutput: unknown = { verdict: "pass" }

  async launch(run: QueuedAgentRun) {
    this.launches.push(run)
  }

  async reconcileRun() {
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("cross-provider Runtime delegation", () => {
  it.each([
    ["codex", "claude-code", "claude-code"],
    ["claude-code", "codex", "codex"],
  ] as const)(
    "requires an exact preview and creates a durable %s-to-%s child without private context",
    (sourceHarness, targetHarness, preference) => {
      const fixture = createFixture(sourceHarness)
      const runtime = new RuntimeStub()
      const service = new CrossProviderDelegationService(fixture.path, runtime)
      const request = {
        sourceChatId: "source",
        targetHarness,
        targetModel: `${targetHarness}-model`,
        preference,
        requestId: `${sourceHarness}-to-${targetHarness}`,
        objective: "Review the visible change.",
        requiredCapabilities: ["delegation"],
      }

      expect(() => service.delegate(request)).toThrowError(
        expect.objectContaining<Partial<CrossProviderDelegationError>>({
          code: "preview-required",
        }),
      )
      const preview = service.preview(request)
      const created = service.delegate({
        ...request,
        confirmedPreviewDigest: preview.digest,
      })
      const replay = service.delegate({
        ...request,
        confirmedPreviewDigest: preview.digest,
      })

      expect(created).toMatchObject({ created: true, status: "running", attemptNumber: 1 })
      expect(replay).toMatchObject({
        created: false,
        attemptId: created.attemptId,
        childChatId: created.childChatId,
        runId: created.runId,
      })
      expect(runtime.launches).toHaveLength(1)
      const db = new Database(fixture.path)
      const child = db
        .prepare(
          `SELECT c.parent_chat_id, c.harness, s.session_id
           FROM chats c JOIN sub_chats s ON s.chat_id = c.id WHERE c.id = ?`,
        )
        .get(created.childChatId)
      expect(child).toEqual({
        parent_chat_id: "source",
        harness: targetHarness,
        session_id: null,
      })
      const durable = db
        .prepare(
          "SELECT task_envelope, preview_digest FROM runtime_composition_attempts WHERE attempt_id = ?",
        )
        .get(created.attemptId) as { task_envelope: string; preview_digest: string }
      expect(durable.preview_digest).toBe(preview.digest)
      expect(durable.task_envelope).toContain("Review the visible change.")
      expect(durable.task_envelope).not.toContain("PRIVATE_REASONING")
      expect(durable.task_envelope).not.toContain("SECRET_CREDENTIAL")
      db.close()
    },
  )

  it("blocks incompatible targets, authority widening, and stale worktree previews without fallback", () => {
    const fixture = createFixture("codex")
    const service = new CrossProviderDelegationService(fixture.path, new RuntimeStub())
    const incompatible = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "codex" as const,
      requestId: "incompatible-target",
      objective: "Review.",
    }
    expect(() => service.preview(incompatible)).toThrow(/incompatible/i)

    const widening = {
      ...incompatible,
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
      ...incompatible,
      preference: "claude-code" as const,
      requestId: "stale-preview",
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

  it("uses a capability lattice so restrictive custom authority cannot widen by changing modes", () => {
    const fixture = createFixture("codex")
    setSourcePermission(fixture.path, "custom", {
      ...disabledCapabilities(),
      projectWrite: false,
    })
    const service = new CrossProviderDelegationService(fixture.path, new RuntimeStub())
    const base = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      objective: "Review.",
    }

    for (const permissionMode of [
      "ask-before-edits",
      "auto-edit-project-only",
      "full-access",
    ] as const) {
      expect(() =>
        service.preview({
          ...base,
          requestId: `custom-to-${permissionMode}`,
          authorityRestrictions: { permissionMode },
        }),
      ).toThrowError(
        expect.objectContaining<Partial<CrossProviderDelegationError>>({
          code: "authority-widening",
        }),
      )
    }

    const db = new Database(fixture.path)
    db.prepare(
      `UPDATE chats SET custom_permissions = '{"projectWrite":true}' WHERE id = 'source'`,
    ).run()
    db.close()
    expect(() =>
      service.preview({
        ...base,
        requestId: "malformed-custom-parent",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CrossProviderDelegationError>>({
        code: "authority-widening",
      }),
    )
  })

  it("persists and enforces exact custom capabilities instead of silently dropping them", () => {
    const fixture = createFixture("codex")
    setSourcePermission(fixture.path, "full-access", null)
    const runtime = new RuntimeStub()
    const service = new CrossProviderDelegationService(fixture.path, runtime)
    const customPermissions = {
      ...disabledCapabilities(),
      projectWrite: true,
      git: true,
    }
    const request = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "exact-custom-permissions",
      objective: "Review.",
      authorityRestrictions: {
        permissionMode: "custom" as const,
        customPermissions,
        allowedToolTiers: ["read", "project-write", "git"] as const,
        network: false,
      },
    }

    const preview = service.preview(request)
    expect(preview.authorityCeiling).toMatchObject({
      permissionMode: "custom",
      customPermissions,
      allowedToolTiers: ["read", "project-write", "git"],
      network: false,
    })
    expect(preview.targetSnapshot.permission).toEqual({
      mode: "custom",
      customPermissions,
    })
    const created = service.delegate({ ...request, confirmedPreviewDigest: preview.digest })

    expect(runtime.launches[0]).toMatchObject({
      runId: created.runId,
      permissionMode: "custom",
      customPermissions: JSON.stringify(customPermissions),
      runtimeLaunch: {
        permission: {
          mode: "custom",
          customPermissions: expect.objectContaining({
            projectWrite: true,
            git: true,
            network: false,
          }),
        },
      },
    })
    const db = new Database(fixture.path)
    const child = db
      .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = ?")
      .get(created.childChatId) as { permission_mode: string; custom_permissions: string }
    const run = db
      .prepare("SELECT permission_mode, custom_permissions FROM agent_runs WHERE id = ?")
      .get(created.runId) as { permission_mode: string; custom_permissions: string }
    const attempt = db
      .prepare(
        `SELECT task_envelope, target_snapshot
         FROM runtime_composition_attempts WHERE attempt_id = ?`,
      )
      .get(created.attemptId) as { task_envelope: string; target_snapshot: string }
    db.close()

    expect(child.permission_mode).toBe("custom")
    expect(JSON.parse(child.custom_permissions)).toEqual(customPermissions)
    expect(run.permission_mode).toBe("custom")
    expect(JSON.parse(run.custom_permissions)).toEqual(customPermissions)
    expect(JSON.parse(attempt.task_envelope).permissionCeiling).toMatchObject({
      permissionMode: "custom",
      customPermissions,
      allowedToolTiers: ["read", "project-write", "git"],
    })
    expect(JSON.parse(attempt.target_snapshot).permission).toEqual({
      mode: "custom",
      customPermissions,
    })
  })

  it("rejects tool-tier restrictions that the selected non-custom mode cannot enforce", () => {
    const fixture = createFixture("codex")
    setSourcePermission(fixture.path, "full-access", null)
    const service = new CrossProviderDelegationService(fixture.path, new RuntimeStub())

    expect(() =>
      service.preview({
        sourceChatId: "source",
        targetHarness: "claude-code",
        targetModel: "claude",
        preference: "claude-code",
        requestId: "unenforced-tier-restriction",
        objective: "Review.",
        authorityRestrictions: {
          permissionMode: "full-access",
          allowedToolTiers: ["read"],
          network: false,
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CrossProviderDelegationError>>({
        code: "authority-widening",
      }),
    )
  })

  it("blocks secret-bearing objectives before cross-provider preview or persistence", () => {
    const fixture = createFixture("codex")
    const service = new CrossProviderDelegationService(fixture.path, new RuntimeStub())

    expect(() =>
      service.preview({
        sourceChatId: "source",
        targetHarness: "claude-code",
        targetModel: "claude",
        preference: "claude-code",
        requestId: "secret-objective",
        objective: "Review OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CrossProviderDelegationError>>({
        code: "secret-detected",
      }),
    )

    const db = new Database(fixture.path)
    const attempts = db
      .prepare("SELECT COUNT(*) count FROM runtime_composition_attempts")
      .get() as { count: number }
    const leaked = db
      .prepare(
        `SELECT COUNT(*) count FROM agent_runs
         WHERE initial_prompt LIKE '%sk-proj-abcdefghijklmnopqrstuv%'`,
      )
      .get() as { count: number }
    db.close()
    expect(attempts.count).toBe(0)
    expect(leaked.count).toBe(0)
  })

  it("uses explicit retry identity and restart reconciliation without replay", async () => {
    const fixture = createFixture("codex")
    const runtime = new RuntimeStub()
    const request = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "first-attempt",
      objective: "Review.",
    }
    const firstService = new CrossProviderDelegationService(fixture.path, runtime)
    const preview = firstService.preview(request)
    const first = firstService.delegate({ ...request, confirmedPreviewDigest: preview.digest })
    await Promise.resolve()
    expect(runtime.launches).toHaveLength(1)

    const restarted = new CrossProviderDelegationService(fixture.path, runtime)
    const same = restarted.delegate({ ...request, confirmedPreviewDigest: preview.digest })
    await Promise.resolve()
    expect(same.created).toBe(false)
    expect(runtime.launches).toHaveLength(1)

    const changedIntent = { ...request, objective: "Implement instead." }
    const changedPreview = restarted.preview(changedIntent)
    expect(() =>
      restarted.delegate({
        ...changedIntent,
        confirmedPreviewDigest: changedPreview.digest,
      }),
    ).toThrow(/already bound to a different exact launch intent/i)
    expect(runtime.launches).toHaveLength(1)

    expect(() =>
      restarted.delegate({
        ...request,
        deadline: "2030-01-01T00:00:00.000Z",
        confirmedPreviewDigest: preview.digest,
      }),
    ).toThrow(/already bound to a different exact launch intent/i)
    expect(runtime.launches).toHaveLength(1)

    const retryRequest = {
      ...request,
      requestId: "second-attempt",
      priorAttemptId: first.attemptId,
    }
    const retryPreview = restarted.preview(retryRequest)
    const retry = restarted.delegate({
      ...retryRequest,
      confirmedPreviewDigest: retryPreview.digest,
    })
    expect(retry.attemptNumber).toBe(2)
    expect(retry.attemptId).not.toBe(first.attemptId)
  })

  it("reconciles durable running attempts on startup without replay", async () => {
    const fixture = createFixture("codex")
    const runtime = new RuntimeStub()
    const service = new CrossProviderDelegationService(fixture.path, runtime)
    const request = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "startup-recovery",
      objective: "Review.",
    }
    const preview = service.preview(request)
    const created = service.delegate({ ...request, confirmedPreviewDigest: preview.digest })
    const secondRequest = { ...request, requestId: "startup-recovery-second" }
    const secondPreview = service.preview(secondRequest)
    const second = service.delegate({
      ...secondRequest,
      confirmedPreviewDigest: secondPreview.digest,
    })
    await Promise.resolve()
    expect(runtime.launches).toHaveLength(2)

    const restarted = new CrossProviderDelegationService(fixture.path, runtime)
    await expect(restarted.recoverRunningAttempts(1)).resolves.toEqual({
      attempted: 1,
      failed: 0,
      remaining: 2,
    })
    await expect(restarted.recoverRunningAttempts(1)).resolves.toEqual({
      attempted: 1,
      failed: 0,
      remaining: 2,
    })
    runtime.state = "completed"
    await expect(restarted.recoverRunningAttempts(1)).resolves.toEqual({
      attempted: 1,
      failed: 0,
      remaining: 1,
    })
    await expect(restarted.recoverRunningAttempts(1)).resolves.toEqual({
      attempted: 1,
      failed: 0,
      remaining: 0,
    })
    expect(runtime.launches).toHaveLength(2)
    expect(await restarted.reconcile(created.attemptId)).toMatchObject({ status: "success" })
    expect(await restarted.reconcile(second.attemptId)).toMatchObject({ status: "success" })
  })

  it("lets provider terminal truth win cancellation and keeps one durable usage/result projection", async () => {
    const fixture = createFixture("claude-code")
    const runtime = new RuntimeStub()
    const service = new CrossProviderDelegationService(fixture.path, runtime)
    const request = {
      sourceChatId: "source",
      targetHarness: "codex" as const,
      targetModel: "gpt",
      preference: "codex" as const,
      requestId: "cancel-terminal-race",
      objective: "Review.",
      outputSchema: { type: "object" },
      requiredCapabilities: ["structuredOutput"],
    }
    const preview = service.preview(request)
    const created = service.delegate({ ...request, confirmedPreviewDigest: preview.digest })
    const db = new Database(fixture.path)
    db.prepare(
      `INSERT INTO usage_samples (
        id, provider_id, account_tag, source, cost_quality, currency, run_id,
        attribution_state, attribution_run_id, source_class, dedupe_strategy,
        dedupe_key, created_at
      ) VALUES ('usage-1', 'openai', '', 'flapstack-run', 'exact', 'USD', ?,
        'attributed', ?, 'flapstack-run', 'exact-fact', 'usage-dedupe-1', 1)`,
    ).run(created.runId, created.runId)
    db.prepare(
      `INSERT INTO agent_activity_events (
        event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
        kind, phase, display_class, privacy_class, redaction_state, received_at,
        payload_json, created_at
      ) VALUES ('visible-result', ?, ?, ?, 'codex', 'codex', 'openai', 1,
        'agent-text', 'completed', 'summary', 'public', 'none', 1,
        '{"text":"Visible result"}', 1)`,
    ).run(created.runId, created.childChatId, created.childSubChatId)
    db.prepare("UPDATE agent_runs SET status = 'success', completed_at = 2 WHERE id = ?").run(
      created.runId,
    )
    db.close()
    runtime.state = "completed"

    const result = await service.cancel(created.attemptId, "No longer needed")
    expect(runtime.cancellations).toEqual([created.runId])
    expect(result.result).toMatchObject({
      status: "success",
      structuredOutput: { verdict: "pass" },
      usageRefs: [{ usageRecordId: "usage-1", runId: created.runId }],
      visibleSummary: "Visible result",
      cancellationRequestedAt: expect.any(String),
    })
    const replay = await service.reconcile(created.attemptId)
    expect(replay.result).toEqual(result.result)
  })

  it("fails the result barrier when required structured output violates its reviewed schema", async () => {
    const fixture = createFixture("codex")
    const runtime = new RuntimeStub()
    runtime.structuredOutput = { verdict: 42 }
    const service = new CrossProviderDelegationService(fixture.path, runtime)
    const request = {
      sourceChatId: "source",
      targetHarness: "claude-code" as const,
      targetModel: "claude",
      preference: "claude-code" as const,
      requestId: "invalid-structured-output",
      objective: "Review.",
      outputSchema: {
        type: "object",
        required: ["verdict"],
        properties: { verdict: { type: "string" } },
        additionalProperties: false,
      },
    }
    const preview = service.preview(request)
    const created = service.delegate({ ...request, confirmedPreviewDigest: preview.digest })
    runtime.state = "completed"

    const result = await service.reconcile(created.attemptId)

    expect(result.result).toMatchObject({
      status: "failure",
      structuredOutput: null,
      limitations: [expect.stringMatching(/failed validation/i)],
      terminalEvidence: { providerTerminalState: "completed" },
    })
  })

  it.each([
    {
      label: "structured output",
      structuredOutput: {
        verdict: "pass",
        apiKey: "sk-proj-abcdefghijklmnopqrstuv",
      },
      visibleSummary: "Visible result",
    },
    {
      label: "visible public summary",
      structuredOutput: { verdict: "pass" },
      visibleSummary: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv",
    },
  ])(
    "blocks secret-bearing $label before result persistence or transfer",
    async ({ structuredOutput, visibleSummary }) => {
      const fixture = createFixture("codex")
      const runtime = new RuntimeStub()
      runtime.structuredOutput = structuredOutput
      const service = new CrossProviderDelegationService(fixture.path, runtime)
      const request = {
        sourceChatId: "source",
        targetHarness: "claude-code" as const,
        targetModel: "claude",
        preference: "claude-code" as const,
        requestId: `secret-result-${visibleSummary === "Visible result" ? "structured" : "summary"}`,
        objective: "Review.",
        outputSchema: { type: "object" },
      }
      const preview = service.preview(request)
      const created = service.delegate({ ...request, confirmedPreviewDigest: preview.digest })
      const db = new Database(fixture.path)
      db.prepare(
        `INSERT INTO agent_activity_events (
          event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
          kind, phase, display_class, privacy_class, redaction_state, received_at,
          payload_json, created_at
        ) VALUES ('secret-result', ?, ?, ?, 'claude-code', 'claude-code', 'anthropic', 1,
          'agent-text', 'completed', 'summary', 'public', 'none', 1, ?, 1)`,
      ).run(
        created.runId,
        created.childChatId,
        created.childSubChatId,
        JSON.stringify({ text: visibleSummary }),
      )
      db.close()
      runtime.state = "completed"

      const result = await service.reconcile(created.attemptId)

      expect(result.result).toMatchObject({
        status: "failure",
        structuredOutput: null,
        visibleSummary: visibleSummary === "Visible result" ? "Visible result" : "",
        limitations: [expect.stringMatching(/secret.*blocked/i)],
      })
      expect(JSON.stringify(result.result)).not.toContain("sk-proj-abcdefghijklmnopqrstuv")
      const persistedDb = new Database(fixture.path)
      const persisted = persistedDb
        .prepare("SELECT result_envelope FROM runtime_composition_attempts WHERE attempt_id = ?")
        .get(created.attemptId) as { result_envelope: string }
      persistedDb.close()
      expect(persisted.result_envelope).not.toContain("sk-proj-abcdefghijklmnopqrstuv")
    },
  )
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

function disabledCapabilities() {
  return {
    schemaVersion: 1 as const,
    projectWrite: false,
    shell: false,
    network: false,
    git: false,
    browser: false,
    secrets: false,
    subagents: false,
    thirdPartyMcp: false,
    productMcpRead: false,
    productMcpWrite: false,
    productMcpTier3: false,
  }
}

function setSourcePermission(
  databasePath: string,
  mode: string,
  customPermissions: ReturnType<typeof disabledCapabilities> | null,
) {
  const db = new Database(databasePath)
  db.prepare(
    `UPDATE chats SET permission_mode = ?, custom_permissions = ? WHERE id = 'source'`,
  ).run(mode, customPermissions ? JSON.stringify(customPermissions) : null)
  db.close()
}
