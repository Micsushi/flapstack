import { describe, expect, it } from "vitest"
import {
  resolveChatStatus,
  summarizeChatStatuses,
} from "../src/renderer/features/agents/lib/chat-status"
import { markChatSeen } from "../src/renderer/features/agents/lib/chat-unseen-state"

describe("Independent read, runtime and work status", () => {
  it.each(["ready", null, "unexpected"])("does not treat %s as verified work", (runStatus) => {
    expect(resolveChatStatus({ runStatuses: [runStatus] }).outcome).toBe("unknown")
  })

  it.each(["success", "completed"])("keeps %s distinct from verified work", (runStatus) => {
    expect(resolveChatStatus({ runStatuses: [runStatus] })).toMatchObject({
      outcome: "completed-unverified",
      outcomes: ["completed-unverified"],
    })
  })

  it.each([
    ["running", "unknown"],
    ["needs-input", "unknown"],
    ["cancelled", "stopped-incomplete"],
    ["blocked", "blocked"],
    ["failure", "failed"],
    [null, "unknown"],
  ] as const)("reading preserves %s runtime and outcome", (runStatus, outcome) => {
    const unread = new Set(["chat"])
    const before = resolveChatStatus({ unread: unread.has("chat"), runStatuses: [runStatus] })
    const after = resolveChatStatus({
      unread: markChatSeen(unread, "chat").has("chat"),
      runStatuses: [runStatus],
    })
    expect(before.outcome).toBe(outcome)
    expect(before.unread).toBe(true)
    expect(after).toEqual({ ...before, unread: false })
  })

  it("keeps simultaneous running, needs-input, and failed group members visible", () => {
    const summary = summarizeChatStatuses([
      resolveChatStatus({ unread: true, runStatuses: ["running"] }),
      resolveChatStatus({ needsHelp: true, runStatuses: ["failure"] }),
      resolveChatStatus({ runStatuses: ["cancelled"] }),
    ])
    expect(summary).toEqual({
      unread: 1,
      running: 1,
      needsHelp: 1,
      outcomes: ["unknown", "failed", "stopped-incomplete"],
    })
  })

  it("restores saved terminal truth without inventing verification", () => {
    const saved = JSON.parse(JSON.stringify(["success", "cancelled", "failure"]))
    expect(resolveChatStatus({ runStatuses: saved })).toMatchObject({
      outcome: "failed",
      outcomes: ["failed", "stopped-incomplete", "completed-unverified"],
    })
    expect(
      resolveChatStatus({ running: true, needsHelp: true, runStatuses: ["failure"] }),
    ).toMatchObject({ running: true, needsHelp: true, outcome: "failed" })
  })

  it("preserves every distinct outcome from simultaneous sub-chats", () => {
    const status = resolveChatStatus({ runStatuses: ["failure", "blocked", "cancelled"] })
    expect(summarizeChatStatuses([status]).outcomes).toEqual([
      "failed",
      "blocked",
      "stopped-incomplete",
    ])
  })

  it("keeps durable dependency wait failures distinct from run failures", () => {
    expect(resolveChatStatus({ blocked: true }).outcomes).toEqual(["blocked"])
    expect(resolveChatStatus({ dependencyWaitFailed: true }).outcomes).toEqual([
      "dependency-wait-failed",
    ])
    expect(
      resolveChatStatus({ dependencyWaitFailed: true, runStatuses: ["failure"] }).outcomes,
    ).toEqual(["failed", "dependency-wait-failed"])
  })

  it("never promotes a completed run to verified work", () => {
    expect(resolveChatStatus({ runStatuses: ["success"] }).outcomes).not.toContain(
      "verified-complete",
    )
  })
})
