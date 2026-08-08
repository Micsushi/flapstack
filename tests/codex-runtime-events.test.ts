import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CodexProtocolDriftError,
  mapCodexNotification,
  permissionActivity,
} from "../src/main/lib/agent-runtime/codex/events"

describe("direct Codex Runtime event mapping", () => {
  it("preserves pinned displayable identities, indices, sections, and event kinds", () => {
    const fixture = readFileSync(
      join(process.cwd(), "tests/fixtures/agent-runtime/codex/app-server-events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const events = fixture.flatMap(mapCodexNotification)
    events.push(
      permissionActivity(
        "item/commandExecution/requestApproval",
        { threadId: "thread-1", turnId: "turn-1", itemId: "command-1" },
        "started",
      ),
    )

    expect(new Set(events.map((event) => event.kind))).toEqual(
      new Set([
        "lifecycle",
        "agent-text",
        "reasoning-summary",
        "provider-visible-reasoning",
        "private-metadata",
        "plan",
        "command",
        "patch",
        "tool",
        "usage",
        "warning",
        "compaction",
        "permission",
      ]),
    )
    expect(events.some((event) => event.providerThreadId === "thread-1")).toBe(true)
    expect(events.some((event) => event.providerTurnId === "turn-1")).toBe(true)
    expect(events.some((event) => event.providerItemId === "reasoning-1")).toBe(true)
    expect(events.some((event) => event.summaryIndex === 0)).toBe(true)
    expect(events.some((event) => event.contentIndex === 1)).toBe(true)
    expect(events.some((event) => event.sectionBoundary === "summary-part-added")).toBe(true)
    expect(JSON.stringify(events)).toContain("VISIBLE_SUMMARY_A")
    expect(JSON.stringify(events)).toContain("VISIBLE_REASONING_A")
    expect(JSON.stringify(events)).not.toContain("PRIVATE_REASONING_A")
  })

  it("bounds and redacts harmless unknown metadata before append", () => {
    const events = mapCodexNotification({
      method: "account/customMetadata",
      params: {
        authorization: "Bearer should-not-survive",
        huge: "x".repeat(100_000),
        nested: { a: { b: { c: { d: { e: { f: { g: "too-deep" } } } } } } },
        entries: Object.fromEntries(
          Array.from({ length: 200 }, (_, index) => [`k${index}`, index]),
        ),
      },
    })
    const serialized = JSON.stringify(events)
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(65_536)
    expect(serialized).toContain("[redacted]")
    expect(serialized).toContain("[truncated-depth]")
    expect(serialized).not.toContain("should-not-survive")

    const rootArray = mapCodexNotification({
      method: "account/rootArray",
      params: { values: Array.from({ length: 100 }, () => "y".repeat(4_096)) },
    })
    expect(Buffer.byteLength(JSON.stringify(rootArray), "utf8")).toBeLessThan(65_536)

    const plan = mapCodexNotification({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "z".repeat(100_000),
        plan: Array.from({ length: 500 }, (_, index) => ({
          id: `step-${index}`,
          step: "p".repeat(100_000),
          status: "pending",
        })),
      },
    })
    expect(Buffer.byteLength(JSON.stringify(plan[0].payload), "utf8")).toBeLessThan(65_536)
  })

  it("fails closed on unknown execution and permission semantics", () => {
    expect(() =>
      mapCodexNotification({ method: "turn/futureExecution", params: { threadId: "thread-1" } }),
    ).toThrow(CodexProtocolDriftError)
    expect(() =>
      mapCodexNotification({ method: "item/futurePermission", params: { itemId: "item-1" } }),
    ).toThrow(CodexProtocolDriftError)

    const failed = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: { message: "TERMINAL_ERROR_A" },
      },
    })
    expect(failed).toMatchObject([
      { kind: "lifecycle", phase: "failed", payload: { detail: "TERMINAL_ERROR_A" } },
    ])
  })

  it("preserves structured Codex tool arguments and results", () => {
    const [event] = mapCodexNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "mcpToolCall",
          id: "tool-1",
          server: "filesystem",
          tool: "read_file",
          status: "completed",
          arguments: { path: "src/app.ts" },
          result: { content: "export const ready = true" },
        },
      },
    })

    expect(event).toMatchObject({
      kind: "tool",
      providerToolId: "tool-1",
      payload: {
        input: { path: "src/app.ts" },
        output: { content: "export const ready = true" },
      },
    })
  })

  it("preserves current context usage and model window", () => {
    expect(
      mapCodexNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            last: {
              inputTokens: 42_057,
              cachedInputTokens: 39_680,
              outputTokens: 470,
              reasoningOutputTokens: 186,
            },
            modelContextWindow: 258_400,
          },
        },
      }),
    ).toMatchObject([
      {
        kind: "usage",
        payload: {
          inputTokens: 42_057,
          cachedTokens: 39_680,
          contextWindow: 258_400,
        },
      },
    ])
  })
})
