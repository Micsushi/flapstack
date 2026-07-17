import { describe, expect, it } from "vitest"
import {
  formatScopeChatTimestamp,
  getScopeChatContext,
  normalizeScopeChatDate,
  scopeChatTimestampMs,
} from "../src/renderer/features/agents/lib/scope-chat-card"

describe("project scope Chat cards", () => {
  it("repairs a millisecond value that Drizzle hydrated as seconds", () => {
    const malformed = new Date(1_784_160_859_000_000)
    const repaired = normalizeScopeChatDate(malformed)

    expect(repaired?.toISOString()).toBe("2026-07-16T00:14:19.000Z")
    expect(scopeChatTimestampMs(malformed)).toBe(1_784_160_859_000)
    expect(formatScopeChatTimestamp(malformed)).not.toContain("58507")
  })

  it("accepts SQLite epoch seconds and normal JavaScript dates", () => {
    expect(normalizeScopeChatDate(1_784_160_859)?.toISOString()).toBe("2026-07-16T00:14:19.000Z")
    expect(normalizeScopeChatDate(new Date("2026-07-15T00:14:19Z"))?.toISOString()).toBe(
      "2026-07-15T00:14:19.000Z",
    )
  })

  it("shows the parent task, archived state, and fixture origin", () => {
    expect(
      getScopeChatContext(
        { name: "S4-F9-T4 1784067241167 linked chat", taskId: "task-1" },
        {
          id: "task-1",
          name: "S4-F9-T4 1784067241167 Beta linked chat",
          description: "Live real-task Kanban proof",
          archivedAt: new Date(),
        },
      ),
    ).toEqual({
      taskName: "S4-F9-T4 1784067241167 Beta linked chat",
      taskArchived: true,
      testFixture: true,
    })
  })

  it("does not label ordinary task Chats as fixtures", () => {
    expect(
      getScopeChatContext(
        { name: "Implement login", taskId: "task-1" },
        { id: "task-1", name: "Authentication", archivedAt: null },
      ),
    ).toEqual({ taskName: "Authentication", taskArchived: false, testFixture: false })
  })
})
