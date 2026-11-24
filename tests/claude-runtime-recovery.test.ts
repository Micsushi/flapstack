import { describe, expect, it, vi } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  ClaudeRuntimeUncertainError,
  createClaudeCodeRuntimeAdapter,
} from "../src/main/lib/agent-runtime/claude-code"
import { baseDependencies, collect, iterable, runtimeContext } from "./claude-runtime-test-helpers"

describe("Claude Runtime session and restart recovery", () => {
  it("retries a stale session once only before provider delivery", async () => {
    const queries: Record<string, unknown>[] = []
    const clearStaleSession = vi.fn(async () => undefined)
    let attempt = 0
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        loadSession: async () => ({ sessionId: "stale-session", resumeAtUuid: "assistant-old" }),
        clearStaleSession,
        isMissingSessionError: (error) =>
          String((error as Error)?.message || error).includes("No conversation"),
        query(input) {
          queries.push({ ...input.options })
          attempt += 1
          if (attempt === 1)
            return throwingIterable(new Error("No conversation found with session ID"))
          return iterable([
            {
              type: "result",
              subtype: "success",
              duration_ms: 1,
              duration_api_ms: 1,
              is_error: false,
              num_turns: 1,
              result: "VISIBLE_RESULT",
              stop_reason: "end_turn",
              total_cost_usd: 0,
              usage: { input_tokens: 1, output_tokens: 1 },
              modelUsage: {},
              permission_denials: [],
              uuid: "result-retry",
              session_id: "fresh-session",
            } as unknown as SDKMessage,
          ])
        },
      }),
    )
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")
    const activities = await collect(adapter.streamActivity(context, session, turn))

    expect(clearStaleSession).toHaveBeenCalledWith(context, "stale-session")
    expect(queries).toHaveLength(2)
    expect(queries[0]).toMatchObject({ resume: "stale-session", resumeSessionAt: "assistant-old" })
    expect(queries[1]).not.toHaveProperty("resume")
    expect(activities).toContainEqual(
      expect.objectContaining({ kind: "lifecycle", phase: "completed" }),
    )
  })

  it("marks an empty stream uncertain and refuses completion", async () => {
    const appended: unknown[] = []
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        appendActivity(_context, batch) {
          appended.push(...batch)
        },
      }),
    )
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")

    await expect(collect(adapter.streamActivity(context, session, turn))).rejects.toBeInstanceOf(
      ClaudeRuntimeUncertainError,
    )
    expect(appended).toContainEqual(expect.objectContaining({ kind: "warning", phase: "failed" }))
    expect(await adapter.reconcile(context)).toBe("uncertain")
    await expect(adapter.complete(context)).rejects.toBeInstanceOf(ClaudeRuntimeUncertainError)
  })

  it("marks a mid-stream throw uncertain and persists mapped activity before diagnostics", async () => {
    const appended: unknown[][] = []
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        appendActivity(_context, batch) {
          appended.push([...batch])
        },
        query: () => partialThenThrow(),
      }),
    )
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")

    await expect(collect(adapter.streamActivity(context, session, turn))).rejects.toThrow(
      "provider disconnected",
    )
    expect(appended[0]).toContainEqual(expect.objectContaining({ kind: "lifecycle" }))
    expect(appended.at(-1)).toContainEqual(expect.objectContaining({ kind: "warning" }))
    expect(await adapter.reconcile(context)).toBe("uncertain")
  })

  it("routes context abort through exactly-once provider cancellation", async () => {
    const external = new AbortController()
    const cancel = vi.fn(async () => undefined)
    const appended: Array<{ kind?: string; phase?: string }> = []
    let streamSignal: AbortSignal | null = null
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        cancel,
        appendActivity(_context, batch) {
          appended.push(...batch)
        },
        query(input) {
          streamSignal = (input.options.abortController as AbortController).signal
          return untilAbort(streamSignal)
        },
      }),
    )
    const context = { ...runtimeContext(), signal: external.signal }
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")
    const collecting = collect(adapter.streamActivity(context, session, turn))
    await vi.waitFor(() => expect(streamSignal).not.toBeNull())
    await vi.waitFor(() =>
      expect(appended).toContainEqual(expect.objectContaining({ kind: "lifecycle" })),
    )
    external.abort("external-stop")
    await expect(collecting).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "lifecycle" })]),
    )
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(appended).toContainEqual(
        expect.objectContaining({ kind: "lifecycle", phase: "cancelled" }),
      ),
    )
    expect(await adapter.reconcile(context)).toBe("completed")
  })

  it("aborts provider work even when cancellation activity persistence fails", async () => {
    const cancel = vi.fn(async () => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        cancel,
        appendActivity: async () => {
          throw new Error("activity store unavailable")
        },
      }),
    )
    const context = runtimeContext()
    await adapter.startSession(context)
    await expect(adapter.cancel(context, "user-stop")).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
    expect(await adapter.reconcile(context)).toBe("completed")
    error.mockRestore()
  })

  it("reconciles from persisted authority after restart and cleans up idempotently", async () => {
    const reconcile = vi.fn(async (_context, session) =>
      session.providerSessionId === "persisted-session"
        ? ("running" as const)
        : ("uncertain" as const),
    )
    const restarted = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        loadSession: async () => ({ sessionId: "persisted-session" }),
        reconcile,
      }),
    )
    const context = runtimeContext()
    await expect(restarted.reconcile(context)).resolves.toBe("running")
    expect(reconcile).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ providerSessionId: "persisted-session" }),
    )

    const failClosed = createClaudeCodeRuntimeAdapter(baseDependencies())
    await expect(failClosed.reconcile(context)).resolves.toBe("uncertain")

    await restarted.startSession(context)
    await restarted.cleanup(context)
    await expect(restarted.cleanup(context)).resolves.toBeUndefined()
  })
})

async function* throwingIterable(error: Error): AsyncIterable<SDKMessage> {
  throw error
}

async function* partialThenThrow(): AsyncIterable<SDKMessage> {
  yield {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "2.1.207",
    cwd: "PROJECT_ROOT",
    tools: [],
    mcp_servers: [],
    model: "claude-fixture-model",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "init-before-failure",
    session_id: "session-failure",
  } as unknown as SDKMessage
  throw new Error("provider disconnected")
}

async function* untilAbort(signal: AbortSignal): AsyncIterable<SDKMessage> {
  yield {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "2.1.207",
    cwd: "PROJECT_ROOT",
    tools: [],
    mcp_servers: [],
    model: "claude-fixture-model",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid: "init-before-cancel",
    session_id: "session-cancel",
  } as unknown as SDKMessage
  if (signal.aborted) return
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  )
}
