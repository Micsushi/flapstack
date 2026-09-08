import { describe, expect, it } from "vitest"
import {
  resolveChatStatus,
  summarizeChatStatuses,
} from "../src/renderer/features/agents/lib/chat-status"
import { markChatSeen } from "../src/renderer/features/agents/lib/chat-unseen-state"

describe("Independent read, runtime and work status", () => {
  it.each(["success", "completed", "ready", null, "unexpected"])(
    "does not treat %s as verified work",
    (runStatus) => {
      expect(resolveChatStatus({ runStatuses: [runStatus] }).outcome).toBe("unknown")
    },
  )

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
    expect(resolveChatStatus({ runStatuses: saved }).outcome).toBe("failed")
    expect(
      resolveChatStatus({ running: true, needsHelp: true, runStatuses: ["failure"] }),
    ).toMatchObject({ running: true, needsHelp: true, outcome: "failed" })
  })
})
