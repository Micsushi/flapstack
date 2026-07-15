import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { createClaudeCodeRuntimeAdapter } from "../src/main/lib/agent-runtime/claude-code"
import {
  baseDependencies,
  collect,
  iterable,
  probeInput,
  runtimeContext,
} from "./claude-runtime-test-helpers"

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/agent-runtime/claude-code-sdk-0.3.207.json"),
    "utf8",
  ),
) as { events: SDKMessage[] }

describe("Claude Code Runtime adapter", () => {
  it("preserves native activity identities without synthetic reasoning tools", async () => {
    const persistedSessions: string[] = []
    const persistedUuids: string[] = []
    const appended: unknown[] = []
    let queryOptions: Record<string, unknown> | null = null
    const dependencies = baseDependencies({
      query(input) {
        queryOptions = input.options
        return iterable(fixture.events)
      },
      persistSession(_context, sessionId) {
        persistedSessions.push(sessionId)
      },
      persistMessageUuid(_context, uuid) {
        persistedUuids.push(uuid)
      },
      appendActivity(_context, batch) {
        appended.push(...batch)
      },
    })
    const adapter = createClaudeCodeRuntimeAdapter(dependencies)
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")
    const activities = await collect(adapter.streamActivity(context, session, turn))

    expect(queryOptions).toMatchObject({
      includePartialMessages: true,
      effort: "high",
      thinking: { type: "adaptive", display: "summarized" },
      forwardSubagentText: true,
      includeHookEvents: true,
    })
    expect(persistedSessions).toEqual(["session-1"])
    expect(persistedUuids).toEqual(["assistant-uuid-1", "assistant-child-uuid-1"])
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "provider-visible-reasoning",
          contentIndex: 0,
          providerSessionId: "session-1",
        }),
        expect.objectContaining({
          kind: "subagent",
          providerParentItemId: "tool-1",
          providerMessageId: "assistant-child-uuid-1",
        }),
        expect.objectContaining({
          kind: "lifecycle",
          providerMessageId: "result-uuid-1",
          providerTimestamp: 1784030400000,
          payload: expect.objectContaining({ state: "result:success" }),
        }),
      ]),
    )
    const tools = activities.filter((activity) => activity.kind === "tool")
    expect(tools.some((activity) => activity.payload.name === "ReasoningOutput")).toBe(false)
    expect(appended).toEqual(activities)
    expect(await adapter.reconcile(context)).toBe("completed")
    await expect(adapter.complete(context)).resolves.toBeUndefined()
  })

  it("records permission lifecycle through the existing permission bridge", async () => {
    const recorded: unknown[] = []
    const requestPermission = vi.fn(async () => ({ behavior: "allow", updatedInput: {} }))
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        requestPermission,
        appendActivity(_context, activity) {
          recorded.push(...activity)
        },
      }),
    )
    const context = runtimeContext()
    await adapter.startSession(context)

    await expect(
      adapter.requestPermission(context, { toolName: "Read", toolUseID: "tool-permission-1" }),
    ).resolves.toMatchObject({ behavior: "allow" })
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: "permission",
        phase: "started",
        providerToolId: "tool-permission-1",
      }),
      expect.objectContaining({
        kind: "permission",
        phase: "completed",
        providerToolId: "tool-permission-1",
      }),
    ])
  })

  it("reports pinned availability and exact drift diagnostics", async () => {
    const good = createClaudeCodeRuntimeAdapter(baseDependencies())
    await expect(good.probe("claude-code")).resolves.toMatchObject({
      available: true,
      versions: { adapterVersion: "1", protocolVersion: "claude-agent-sdk/0.3.207" },
    })

    const drifted = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        probe: async () => ({ ...probeInput(), sdkVersion: "0.3.208" }),
      }),
    )
    await expect(drifted.probe("claude-code")).resolves.toMatchObject({
      available: false,
      reason: { code: "protocol-unsupported" },
    })
    const incompatibleProbe = vi.fn(async () => probeInput())
    const incompatible = createClaudeCodeRuntimeAdapter(
      baseDependencies({ probe: incompatibleProbe }),
    )
    await expect(incompatible.probe("codex")).resolves.toMatchObject({
      available: false,
      reason: { code: "runtime-incompatible", harness: "codex" },
    })
    expect(incompatibleProbe).not.toHaveBeenCalled()
  })

  it("returns a sanitized typed unavailable probe when probe authority fails", async () => {
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        probe: async () => {
          throw new Error("probe failed sk-secret /Users/person/private/config")
        },
      }),
    )
    const result = await adapter.probe("claude-code")
    expect(result).toMatchObject({
      available: false,
      reason: { code: "runtime-unavailable" },
    })
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).not.toContain("/Users/person")
  })

  it("stops consuming provider messages after a durably appended result", async () => {
    const appended: unknown[] = []
    const result = fixture.events.at(-1)!
    const adapter = createClaudeCodeRuntimeAdapter(
      baseDependencies({
        query: () =>
          iterable([
            result,
            { type: "future_execution_event", secret: "MUST_NOT_APPEND" } as unknown as SDKMessage,
          ]),
        appendActivity(_context, batch) {
          appended.push(...batch)
        },
      }),
    )
    const context = runtimeContext()
    const session = await adapter.startSession(context)
    const turn = await adapter.startTurn(context, session, "FIXTURE_PROMPT")
    await expect(collect(adapter.streamActivity(context, session, turn))).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "lifecycle", phase: "completed" })]),
    )
    expect(JSON.stringify(appended)).not.toContain("MUST_NOT_APPEND")
  })
})
