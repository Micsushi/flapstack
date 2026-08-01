import { describe, expect, it } from "vitest"
import {
  crossProviderResultEnvelopeSchema,
  crossProviderTaskEnvelopeSchema,
  executionTargetSchema,
} from "../src/shared/runtime-composition"

const digest = "a".repeat(64)
const target = {
  schemaVersion: 1 as const,
  harness: "codex" as const,
  runtime: "codex" as const,
  runtimeMode: "native" as const,
  adapterChain: [],
  provider: "openai",
  model: "gpt-5",
  accountId: "openai-account",
  agentProfile: null,
  permission: { mode: "read-only" as const, customPermissions: null },
  workspace: {
    projectId: "project",
    rootPath: "C:\\repo",
    worktreePath: "C:\\repo",
    branch: "feature",
  },
  capabilities: {
    schemaVersion: 1 as const,
    fingerprint: digest,
    capabilities: { structuredOutput: "available" as const },
  },
  losses: [],
}
const manifest = {
  schemaVersion: 1 as const,
  sourceChatId: "parent",
  sourceRunId: "parent-run",
  selected: [
    {
      sourceSubChatId: "parent-conversation",
      messageId: "message",
      role: "user",
      partIndexes: [0],
      contentDigest: digest,
      byteLength: 12,
    },
  ],
  selectedFileRefs: [],
  selectedArtifactRefs: [],
  omissions: [{ class: "private-reasoning" as const, count: 1 }],
  contentDigest: digest,
  digest,
}
const ceiling = {
  schemaVersion: 1 as const,
  permissionMode: "read-only" as const,
  customPermissions: null,
  allowedToolTiers: ["read" as const],
  network: false,
  maxDescendantDepth: 0,
  tokenBudget: null,
  costBudgetMicros: null,
  providerAccountId: "openai-account",
  allowedProfileSnapshotIds: [],
  workspaceRoot: "C:\\repo",
  worktreePath: "C:\\repo",
  worktreeLeaseId: "lease-1",
}
const attempt = {
  attemptId: "attempt-1",
  attemptNumber: 1,
  priorAttemptId: null,
}

describe("Runtime composition contracts", () => {
  it.each([
    {
      ...target,
      harness: "codex" as const,
      runtime: "claude-code" as const,
      runtimeMode: "native" as const,
    },
    {
      ...target,
      harness: "claude-code" as const,
      runtime: "codex" as const,
      runtimeMode: "enhanced" as const,
    },
    {
      ...target,
      runtimeMode: "translated" as const,
      adapterChain: [],
    },
  ])("rejects forbidden or unproven target combinations", (candidate) => {
    expect(executionTargetSchema.safeParse(candidate).success).toBe(false)
  })

  it.each([
    {
      ...target,
      harness: "codex" as const,
      runtime: "claude-code" as const,
      runtimeMode: "translated" as const,
      adapterChain: [{ id: "openai-to-claude-contract", version: "1" }],
      losses: [{ code: "native-session-fork", summary: "Native session fork is unavailable." }],
    },
    {
      ...target,
      harness: "claude-code" as const,
      runtime: "codex" as const,
      runtimeMode: "translated" as const,
      adapterChain: [{ id: "anthropic-to-codex-contract", version: "1" }],
      provider: "anthropic",
    },
  ])("accepts an explicit translated provider direction with losses", (candidate) => {
    expect(executionTargetSchema.parse(candidate)).toMatchObject({
      runtimeMode: "translated",
      adapterChain: [expect.objectContaining({ version: "1" })],
    })
  })

  it("preserves attempt, lineage, authority, and usage references in versioned envelopes", () => {
    const task = crossProviderTaskEnvelopeSchema.parse({
      version: 1,
      idempotencyKey: "delegate-attempt-1",
      previewDigest: digest,
      mode: "delegate",
      initiatorChatId: "initiator",
      parentChatId: "parent",
      ancestorChatIds: ["initiator"],
      attempt,
      targetSnapshot: target,
      objective: "Review the change.",
      visibleContextManifest: manifest,
      fileAndArtifactRefs: [],
      requiredCapabilities: ["structuredOutput"],
      outputSchema: { type: "object" },
      permissionCeiling: ceiling,
      worktreeLeaseId: null,
      deadline: null,
    })
    const result = crossProviderResultEnvelopeSchema.parse({
      version: 1,
      taskEnvelopeVersion: 1,
      childChatId: "child",
      runId: "child-run",
      attempt,
      targetSnapshot: target,
      status: "success",
      structuredOutput: { verdict: "pass" },
      visibleSummary: "Reviewed.",
      artifactAndChangeRefs: [],
      checkpointRefs: [],
      usageRefs: [
        {
          usageRecordId: "usage-child-run",
          runId: "child-run",
          provider: "openai",
          accountId: "openai-account",
          model: "gpt-5",
          runtime: "codex",
        },
      ],
      activityRefs: [{ runId: "child-run", afterSequence: 9 }],
      partial: false,
      cancellationRequestedAt: null,
      limitations: [],
      warnings: [],
      terminalEvidence: {
        reconciledAt: "2026-07-30T18:00:00.000Z",
        providerTerminalState: "success",
        activityHighWater: 9,
      },
    })

    expect(task.attempt).toEqual(attempt)
    expect(task.permissionCeiling.allowedToolTiers).toEqual(["read"])
    expect(result.usageRefs).toEqual([
      expect.objectContaining({ runId: "child-run", provider: "openai" }),
    ])
  })
})
