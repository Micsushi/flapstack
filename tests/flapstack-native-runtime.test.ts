import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { AgentActivityAppend } from "../src/shared/agent-activity"
import type {
  ResolvedRuntimeLaunch,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"
import {
  extractVisibleMessageParts,
  formatVisiblePartForHandoff,
} from "../src/shared/chat-visible-content"
import { resolveAgentRuntime } from "../src/main/lib/agent-runtime/resolver"
import {
  FLAPSTACK_NATIVE_ROLLBACK_PRESERVES,
  createFlapstackNativeAdapterFactory,
  flapstackNativeCapabilitySnapshot,
  getFlapstackNativeDiagnostics,
  selectFlapstackNativeRollback,
  type FlapstackNativeProviderDelegation,
} from "../src/main/lib/agent-runtime/flapstack-native"

const HARNESSES = [
  "codex",
  "claude-code",
  "cursor-agent",
  "openrouter",
  "nanogpt",
  "local",
  "custom",
  "generic",
  "future-provider",
] as const

type Chunk = { type: string; value: string }

type Fixture = {
  schemaVersion: number
  records: Array<{
    harness: string
    run: Record<string, unknown>
    subChat: {
      id: string
      sessionId: string | null
      messages: Array<{ role: string; parts: Array<Record<string, unknown>>; metadata?: unknown }>
    }
  }>
}

function launch(harness: string): ResolvedRuntimeLaunch {
  return {
    schemaVersion: 1,
    harness,
    model: `${harness}-model`,
    requestedPreference: "flapstack-native",
    preferenceSource: "chat",
    resolvedRuntime: "flapstack-native",
    compatibility: { compatible: true, harness, runtime: "flapstack-native", reason: null },
    versions: getFlapstackNativeDiagnostics(harness).versions,
    capabilities: flapstackNativeCapabilitySnapshot({
      harness,
      available: true,
      capturedAt: "2026-07-14T00:00:00.000Z",
    }),
    controls: {
      schemaVersion: 1,
      modelEffort: null,
      modelThinking: null,
      reasoningDisplay: true,
      subagentActivity: true,
      hookDiagnostics: false,
    },
    permission: { mode: "ask-before-edits", customPermissions: null },
  }
}

function context(harness: string, runId = `run-${harness}`): RuntimeAdapterContext {
  return {
    runId,
    chatId: `chat-${harness}`,
    subChatId: `sub-${harness}`,
    launch: launch(harness),
    signal: new AbortController().signal,
  }
}

function createDelegation(input?: {
  chunks?: Chunk[]
  session?: RuntimeAdapterSession
  projectActivity?: FlapstackNativeProviderDelegation<Chunk>["projectActivity"]
  reconcile?: "running" | "completed" | "uncertain"
}) {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const record = <T>(name: string, value: T, ...args: unknown[]): T => {
    calls.push({ name, args })
    return value
  }
  const chunks = input?.chunks ?? [
    { type: "text-delta", value: "VISIBLE_A" },
    { type: "tool-ReasoningOutput", value: "VISIBLE_REASONING" },
  ]
  const session = input?.session ?? {
    providerSessionId: "provider-session-1",
    providerThreadId: "provider-thread-1",
  }
  const delegation: FlapstackNativeProviderDelegation<Chunk> = {
    probe: () => record("probe", { available: true }),
    startSession: async (_context) => record("startSession", session, _context),
    resumeSession: async (_context, existing) =>
      record("resumeSession", existing, _context, existing),
    startTurn: async (_context, existing, prompt) =>
      record("startTurn", { providerTurnId: "provider-turn-1" }, _context, existing, prompt),
    async *streamActivity(_context, existing, turn) {
      calls.push({ name: "streamActivity", args: [_context, existing, turn] })
      for (const chunk of chunks) yield chunk
    },
    requestPermission: async (_context, request) =>
      record("requestPermission", request, _context, request),
    requestInput: async (_context, request) => record("requestInput", request, _context, request),
    cancel: async (_context, reason) => void record("cancel", undefined, _context, reason),
    complete: async (_context) => void record("complete", undefined, _context),
    reconcile: async (_context) => record("reconcile", input?.reconcile ?? "completed", _context),
    cleanup: async (_context) => void record("cleanup", undefined, _context),
    projectActivity: input?.projectActivity,
  }
  return { calls, chunks, delegation, session }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = []
  for await (const item of iterable) output.push(item)
  return output
}

function fixture(): Fixture {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "tests/fixtures/agent-runtime/flapstack-native-history-v1.json"),
      "utf8",
    ),
  ) as Fixture
}

describe("Flapstack Native Runtime", () => {
  it("publishes explicit provider paths and typed honest limitations", () => {
    const expectedPaths = [
      "codex-acp",
      "claude-transformed",
      "cursor-stream-json",
      "opencode-sidecar",
      "opencode-sidecar",
      "local-model-loop",
      "custom-provider",
      "generic-provider",
      "generic-provider",
    ]
    HARNESSES.forEach((harness, index) => {
      const diagnostics = getFlapstackNativeDiagnostics(harness)
      expect(diagnostics.runtime).toBe("flapstack-native")
      expect(diagnostics.providerPath).toBe(expectedPaths[index])
      expect(diagnostics.versions.adapterVersion).toBe("1.0.0")
      expect(diagnostics.versions.protocolVersion).toContain("stage3-normalized-v1")
      expect(diagnostics.capabilities.historyReload).toBe("supported")
      expect(diagnostics.capabilities.search).toBe("supported")
      expect(diagnostics.capabilities.copy).toBe("supported")
      expect(diagnostics.capabilities.export).toBe("supported")
      expect(diagnostics.limitations.length).toBeGreaterThan(0)
      expect(diagnostics.limitations.every((item) => item.code && item.message)).toBe(true)
    })
    expect(getFlapstackNativeDiagnostics("local").capabilities.providerSessionResume).toBe(
      "unsupported",
    )
  })

  it("allows explicit Native everywhere and rejects first-party runtimes for generic harnesses", () => {
    for (const harness of HARNESSES) {
      const native = resolveAgentRuntime({
        harness,
        chatPreference: "flapstack-native",
        permission: { mode: "read-only", customPermissions: null },
      })
      expect(native.ok).toBe(true)
      if (native.ok) expect(native.launch.resolvedRuntime).toBe("flapstack-native")
    }
    for (const harness of ["cursor-agent", "openrouter", "nanogpt", "local", "custom", "generic"]) {
      for (const runtime of ["codex", "claude-code"] as const) {
        const result = resolveAgentRuntime({
          harness,
          chatPreference: runtime,
          permission: { mode: "read-only", customPermissions: null },
        })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason.code).toBe("runtime-incompatible")
      }
    }
  })

  it.each(HARNESSES)(
    "delegates %s lifecycle without changing chunks or provider identity",
    async (harness) => {
      const fake = createDelegation()
      const adapter = createFlapstackNativeAdapterFactory<Chunk>({
        resolveDelegation: () => fake.delegation,
        now: () => new Date("2026-07-14T00:00:00.000Z"),
      })()
      const runContext = context(harness)

      const probe = await adapter.probe(harness)
      expect(probe.available).toBe(true)
      expect(probe.runtime).toBe("flapstack-native")

      const session = await adapter.startSession(runContext)
      expect(session).toBe(fake.session)
      const prompt = `PROMPT_${harness}`
      const turn = await adapter.startTurn(runContext, session, prompt)
      const streamed = await collect(adapter.streamActivity(runContext, session, turn))
      expect(streamed).toEqual(fake.chunks)
      expect(streamed[0]).toBe(fake.chunks[0])
      expect(streamed[1]).toBe(fake.chunks[1])
      expect(fake.calls.find((call) => call.name === "startTurn")?.args[2]).toBe(prompt)

      const permission = { requestId: "permission-1", mode: "existing-stage3-policy" }
      expect(await adapter.requestPermission(runContext, permission)).toBe(permission)
      const providerInput = { requestId: "input-1", answers: ["A"] }
      expect(await adapter.requestInput(runContext, providerInput)).toBe(providerInput)
      await adapter.cancel(runContext, "user-cancelled")
      expect(await adapter.reconcile(runContext)).toBe("completed")
      await adapter.complete(runContext)
      await adapter.cleanup(runContext)

      expect(fake.calls.map((call) => call.name)).toEqual([
        "probe",
        "startSession",
        "startTurn",
        "streamActivity",
        "requestPermission",
        "requestInput",
        "cancel",
        "reconcile",
        "complete",
        "cleanup",
      ])
    },
  )

  it("resumes using the exact existing provider session without creating a new session", async () => {
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("claude-code", "run-resume")
    const existing = {
      providerSessionId: "claude-existing-session",
      providerThreadId: null,
    }
    const resumed = await adapter.resumeSession(runContext, existing)
    expect(resumed).toBe(existing)
    expect(fake.calls.map((call) => call.name)).toEqual(["resumeSession"])
    expect(fake.calls[0]?.args[1]).toBe(existing)
  })

  it("consumes one turn exactly once and compares provider identities instead of references", async () => {
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("codex", "run-exactly-once")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, { ...session }, "PROMPT")
    expect(await collect(adapter.streamActivity(runContext, { ...session }, { ...turn }))).toEqual(
      fake.chunks,
    )
    await expect(
      collect(adapter.streamActivity(runContext, { ...session }, { ...turn })),
    ).rejects.toThrow("already consumed")
    await expect(adapter.startTurn(runContext, session, "REPLAY")).rejects.toThrow(
      "Prior provider turn",
    )
    await expect(adapter.resumeSession(runContext, session)).rejects.toThrow(
      "Cannot resume during or after",
    )
  })

  it("rejects wrong provider session and turn identities before consuming", async () => {
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("claude-code", "run-wrong-identity")
    const session = await adapter.startSession(runContext)
    await expect(
      adapter.startTurn(
        runContext,
        { providerSessionId: "wrong", providerThreadId: session.providerThreadId },
        "PROMPT",
      ),
    ).rejects.toThrow("session identity")
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    await expect(
      collect(
        adapter.streamActivity(runContext, session, {
          providerTurnId: `${turn.providerTurnId}-wrong`,
        }),
      ),
    ).rejects.toThrow("turn identity")
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(fake.chunks)
  })

  it("requires exact delegation tokens when provider session and turn IDs are null", async () => {
    const fake = createDelegation({
      session: { providerSessionId: null, providerThreadId: null },
    })
    const nullTurn = { providerTurnId: null }
    fake.delegation.startTurn = async () => nullTurn
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("local", "run-null-identities")
    const session = await adapter.startSession(runContext)
    await expect(adapter.startTurn(runContext, { ...session }, "PROMPT")).rejects.toThrow(
      "session identity",
    )
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    await expect(collect(adapter.streamActivity(runContext, session, { ...turn }))).rejects.toThrow(
      "turn identity",
    )
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(fake.chunks)
  })

  it("rolls back newly created resume state after delegation failure", async () => {
    const fake = createDelegation()
    let failResume = true
    const originalResume = fake.delegation.resumeSession
    fake.delegation.resumeSession = async (...args) => {
      if (failResume) {
        failResume = false
        throw new Error("resume failed")
      }
      return await originalResume(...args)
    }
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("cursor-agent", "run-resume-rollback")
    const existing = { providerSessionId: "cursor-existing", providerThreadId: null }
    await expect(adapter.resumeSession(runContext, existing)).rejects.toThrow("resume failed")
    expect(await adapter.startSession(runContext)).toBe(fake.session)
  })

  it("records successful and failed cancellation so no later turn or resume can launch", async () => {
    const successful = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => successful.delegation,
    })()
    const runContext = context("openrouter", "run-cancelled")
    const session = await adapter.startSession(runContext)
    await adapter.startTurn(runContext, session, "PROMPT")
    await adapter.cancel(runContext, "cancelled")
    await expect(adapter.startTurn(runContext, session, "REPLAY")).rejects.toThrow(
      "Prior provider turn",
    )
    await expect(adapter.resumeSession(runContext, session)).rejects.toThrow(
      "Cannot resume during or after",
    )

    const failed = createDelegation()
    failed.delegation.cancel = async () => {
      throw new Error("cancel transport failed")
    }
    const failedAdapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => failed.delegation,
    })()
    const failedContext = context("nanogpt", "run-cancel-uncertain")
    const failedSession = await failedAdapter.startSession(failedContext)
    await failedAdapter.startTurn(failedContext, failedSession, "PROMPT")
    await expect(failedAdapter.cancel(failedContext, "cancelled")).rejects.toThrow(
      "cancel transport failed",
    )
    await expect(failedAdapter.startTurn(failedContext, failedSession, "REPLAY")).rejects.toThrow(
      "Prior provider turn",
    )
  })

  it("projects only stably identified events, deduplicates retries, and keeps chunks unchanged", async () => {
    const appended: AgentActivityAppend[][] = []
    const chunks: Chunk[] = [
      { type: "provider-event", value: "A" },
      { type: "provider-event", value: "A_RETRY" },
      { type: "legacy-event", value: "NO_IDENTITY" },
    ]
    const fake = createDelegation({
      chunks,
      projectActivity: (_context, chunk) => {
        if (chunk.type === "legacy-event") {
          return [activity({ payload: { text: chunk.value } })]
        }
        return [
          activity({
            providerEventId: "provider-event-1",
            dedupKey: "provider-event-1",
            payload: { text: chunk.value },
          }),
        ]
      },
    })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
      appendActivity: (_runId, events) => void appended.push(events),
    })()
    const runContext = context("openrouter", "run-activity")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, session, "UNCHANGED_PROMPT")
    const streamed = await collect(adapter.streamActivity(runContext, session, turn))

    expect(streamed).toEqual(chunks)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toHaveLength(1)
    expect(appended[0]?.[0]?.providerEventId).toBe("provider-event-1")
  })

  it("keeps projection batches atomic across duplicate, retry, append failure, and multi-delta identity", async () => {
    const chunks: Chunk[] = [
      { type: "multi", value: "FIRST_ATTEMPT" },
      { type: "multi", value: "RETRY" },
      { type: "multi", value: "DUPLICATE" },
    ]
    let appendAttempts = 0
    const appended: AgentActivityAppend[][] = []
    const fake = createDelegation({
      chunks,
      projectActivity: () => [
        activity({
          providerSessionId: "session-1",
          providerMessageId: "message-1",
          contentIndex: 0,
          partIndex: 0,
          payload: { text: "DELTA_0" },
        }),
        activity({
          providerSessionId: "session-1",
          providerMessageId: "message-1",
          contentIndex: 0,
          partIndex: 1,
          payload: { text: "DELTA_1" },
        }),
      ],
    })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
      appendActivity: (_runId, events) => {
        appendAttempts += 1
        if (appendAttempts === 1) throw new Error("transient append failure")
        appended.push(events)
      },
    })()
    const runContext = context("openrouter", "run-atomic-projection")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(chunks)
    expect(appendAttempts).toBe(2)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toHaveLength(2)
    expect(appended[0]?.map((event) => event.partIndex)).toEqual([0, 1])
    expect(appended[0]?.every((event) => event.dedupKey?.startsWith("flapstack-native:"))).toBe(
      true,
    )
  })

  it("deduplicates equivalent T3 activity across fresh adapters and partial-overlap batches", async () => {
    const durableKeys = new Set<string>()
    const durableEvents: AgentActivityAppend[] = []
    const appendEquivalentToT3 = (_runId: string, events: AgentActivityAppend[]) => {
      for (const event of events) {
        if (!event.dedupKey || durableKeys.has(event.dedupKey)) continue
        durableKeys.add(event.dedupKey)
        durableEvents.push(event)
      }
    }
    const events = (partIndexes: number[]) =>
      partIndexes.map((partIndex) =>
        activity({
          providerSessionId: "restart-session",
          providerMessageId: "restart-message",
          contentIndex: 0,
          partIndex,
          payload: { text: `DELTA_${partIndex}` },
        }),
      )
    const runOne = createDelegation({ projectActivity: () => events([0, 1]) })
    const adapterOne = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => runOne.delegation,
      appendActivity: appendEquivalentToT3,
    })()
    const firstContext = context("openrouter", "durable-run")
    const firstSession = await adapterOne.startSession(firstContext)
    const firstTurn = await adapterOne.startTurn(firstContext, firstSession, "PROMPT")
    await collect(adapterOne.streamActivity(firstContext, firstSession, firstTurn))

    const runTwo = createDelegation({ projectActivity: () => events([1, 2]) })
    const adapterTwo = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => runTwo.delegation,
      appendActivity: appendEquivalentToT3,
    })()
    const secondContext = context("openrouter", "durable-run")
    const secondSession = await adapterTwo.startSession(secondContext)
    const secondTurn = await adapterTwo.startTurn(secondContext, secondSession, "PROMPT")
    await collect(adapterTwo.streamActivity(secondContext, secondSession, secondTurn))

    expect(durableEvents.map((event) => event.partIndex)).toEqual([0, 1, 2])
    expect(new Set(durableEvents.map((event) => event.dedupKey)).size).toBe(3)
  })

  it("rejects a projecting delegation when durable append authority is absent", async () => {
    const fake = createDelegation({ projectActivity: () => [] })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const probe = await adapter.probe("codex")
    expect(probe.available).toBe(false)
    expect(probe.reason?.message).toContain("durable append authority")
    await expect(adapter.startSession(context("codex", "run-no-append"))).rejects.toThrow(
      "Durable append authority",
    )
  })

  it("fails activity projection open to the unchanged legacy stream", async () => {
    const onProjectionError = vi.fn()
    const fake = createDelegation({
      projectActivity: () => {
        throw new Error("activity store unavailable")
      },
    })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
      appendActivity: () => {
        throw new Error("must not run")
      },
      onProjectionError,
    })()
    const runContext = context("cursor-agent", "run-projection-error")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(fake.chunks)
    expect(onProjectionError).toHaveBeenCalledTimes(fake.chunks.length)
    expect(onProjectionError.mock.calls.every((call) => !(call[1] instanceof Error))).toBe(true)
  })

  it("rejects oversized activity batches and identities before hashing or durable append", async () => {
    const appendActivity = vi.fn()
    const onProjectionError = vi.fn()
    const chunks: Chunk[] = [
      { type: "oversized-batch", value: "BATCH" },
      { type: "oversized-identity", value: "IDENTITY" },
      { type: "invalid-index", value: "INDEX" },
    ]
    const fake = createDelegation({
      chunks,
      projectActivity: (_context, chunk) => {
        if (chunk.type === "oversized-batch") {
          return Array.from({ length: 1_001 }, (_, index) =>
            activity({ providerEventId: `event-${index}` }),
          )
        }
        if (chunk.type === "oversized-identity") {
          return [activity({ providerEventId: `event-${"X".repeat(1_000_000)}` })]
        }
        return [
          activity({
            providerSessionId: "session-1",
            providerMessageId: "message-1",
            partIndex: Number.POSITIVE_INFINITY,
          }),
        ]
      },
    })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
      appendActivity,
      onProjectionError,
    })()
    const runContext = context("openrouter", "run-projection-bounds")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(chunks)
    expect(appendActivity).not.toHaveBeenCalled()
    expect(onProjectionError).toHaveBeenCalledTimes(3)
    expect(
      onProjectionError.mock.calls.every((call) => call[1]?.code === "activity-projection-skipped"),
    ).toBe(true)
  })

  it("passes only sanitized bounded projection diagnostics to callbacks", async () => {
    const providerSecret = "sk-ant-providersecretvalue"
    const storageSecret = "ghp_storagesecret1234567890"
    const privatePath = "/Users/person/private/runtime.log"
    const onProjectionError = vi.fn()
    const chunks: Chunk[] = [
      { type: "provider-error", value: "PROVIDER" },
      { type: "storage-error", value: "STORAGE" },
    ]
    const fake = createDelegation({
      chunks,
      projectActivity: (_context, chunk) => {
        if (chunk.type === "provider-error") {
          throw new Error(`${providerSecret} ${privatePath}`)
        }
        return [activity({ providerEventId: "storage-event-1" })]
      },
    })
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
      appendActivity: () => {
        throw new Error(`${storageSecret} ${privatePath}`)
      },
      onProjectionError,
    })()
    const runContext = context("cursor-agent", "run-sanitized-projection-error")
    const session = await adapter.startSession(runContext)
    const turn = await adapter.startTurn(runContext, session, "PROMPT")
    expect(await collect(adapter.streamActivity(runContext, session, turn))).toEqual(chunks)
    expect(onProjectionError).toHaveBeenCalledTimes(2)
    const serialized = JSON.stringify(onProjectionError.mock.calls.map((call) => call[1]))
    expect(serialized).not.toContain(providerSecret)
    expect(serialized).not.toContain(storageSecret)
    expect(serialized).not.toContain(privatePath)
    expect(serialized).toContain("[REDACTED]")
    expect(serialized).toContain("[PATH]")
    expect(onProjectionError.mock.calls.every((call) => !(call[1] instanceof Error))).toBe(true)
    expect(
      onProjectionError.mock.calls.every((call) => String(call[1]?.message).length <= 512),
    ).toBe(true)
  })

  it("reconciles through persisted provider authority without replaying intent", async () => {
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    expect(await adapter.reconcile(context("codex", "historical-run"))).toBe("completed")
    expect(fake.calls.map((call) => call.name)).toEqual(["reconcile"])

    const unavailable = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => null,
    })()
    expect(await unavailable.reconcile(context("codex", "missing-dependency"))).toBe("uncertain")
  })

  it("keeps cleanup idempotent", async () => {
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const runContext = context("local", "run-cleanup")
    await adapter.startSession(runContext)
    await adapter.cleanup(runContext)
    await adapter.cleanup(runContext)
    expect(fake.calls.filter((call) => call.name === "cleanup")).toHaveLength(1)
  })

  it("opens, searches, copies, exports, and reloads legacy history without rewrite", async () => {
    const history = fixture()
    const before = JSON.stringify(history)
    const fake = createDelegation()
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()

    for (const record of history.records) {
      const projected = adapter.projectLegacyHistory(record.subChat.messages)
      expect(projected.length).toBeGreaterThan(0)
      expect(projected.every((event) => !event.persisted && event.providerIdentity === null)).toBe(
        true,
      )
      const visible = record.subChat.messages.flatMap(extractVisibleMessageParts)
      const copied = visible.map((part) => part.text).join("\n")
      const exported = record.subChat.messages
        .flatMap((message) => message.parts)
        .flatMap(formatVisiblePartForHandoff)
        .join("\n")
      expect(copied || exported).not.toBe("")
      expect(JSON.parse(JSON.stringify(record.subChat.messages))).toEqual(record.subChat.messages)
    }
    expect(JSON.stringify(history)).toBe(before)
    expect(fake.calls).toEqual([])
  })

  it("rollback changes only an explicitly selected default and preserves every durable class", async () => {
    const history = fixture()
    const before = JSON.stringify(history)
    const writes: string[] = []
    await expect(
      selectFlapstackNativeRollback({
        explicitlySelected: false,
        setPreference: (preference) => void writes.push(preference),
      }),
    ).rejects.toThrow("explicit user selection")
    expect(writes).toEqual([])

    const result = await selectFlapstackNativeRollback({
      explicitlySelected: true,
      setPreference: (preference) => void writes.push(preference),
    })
    expect(writes).toEqual(["flapstack-native"])
    expect(result.deleted).toEqual([])
    expect(result.preserved).toEqual(FLAPSTACK_NATIVE_ROLLBACK_PRESERVES)
    expect(JSON.stringify(history)).toBe(before)
  })

  it("returns typed unavailable diagnostics instead of falling back", async () => {
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => null,
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    })()
    const probe = await adapter.probe("openrouter")
    expect(probe).toMatchObject({
      runtime: "flapstack-native",
      harness: "openrouter",
      available: false,
      reason: { code: "runtime-unavailable", runtime: "flapstack-native" },
    })
    expect(probe.capabilities.unavailableReason).toEqual(probe.reason)
  })

  it("redacts and bounds probe diagnostics", async () => {
    const fake = createDelegation()
    fake.delegation.probe = () => {
      throw new Error(
        `sk-secret-value sk-ant-anthropicvalue ghp_1234567890abcdefgh eyJheader123456.payload123456.signature123456 token=label-secret api_key=key-secret bearer bearer-secret /Users/person/private/project ${"X".repeat(900)}`,
      )
    }
    const adapter = createFlapstackNativeAdapterFactory<Chunk>({
      resolveDelegation: () => fake.delegation,
    })()
    const probe = await adapter.probe("codex")
    const message = probe.reason?.message ?? ""
    expect(message).not.toContain("sk-secret-value")
    expect(message).not.toContain("sk-ant-anthropicvalue")
    expect(message).not.toContain("ghp_1234567890abcdefgh")
    expect(message).not.toContain("eyJheader123456")
    expect(message).not.toContain("key-secret")
    expect(message).not.toContain("bearer-secret")
    expect(message).not.toContain("/Users/person")
    expect(message).toContain("[REDACTED]")
    expect(message).toContain("[PATH]")
    expect(message.length).toBeLessThanOrEqual(550)
  })
})

function activity(overrides: Partial<AgentActivityAppend>): AgentActivityAppend {
  return {
    provider: "stage3-provider",
    kind: "agent-text",
    phase: "delta",
    displayClass: "provider-visible",
    privacyClass: "public",
    payload: { text: "VISIBLE" },
    ...overrides,
  } as AgentActivityAppend
}
