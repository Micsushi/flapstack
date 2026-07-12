import { describe, expect, it } from "vitest"
import {
  formatMessageTimestamp,
  getMessageDate,
} from "../src/renderer/features/agents/lib/message-timestamp"

describe("message timestamps", () => {
  it("recovers user timestamps from message ids", () => {
    expect(getMessageDate({ id: "msg-1783365415599" })?.getTime()).toBe(1783365415599)
  })

  it("shows only time for today's messages", () => {
    const value = formatMessageTimestamp(
      { metadata: { createdAt: "2026-07-11T18:30:00-07:00" } },
      new Date("2026-07-11T20:00:00-07:00"),
    )
    expect(value).not.toContain("2026")
  })

  it("shows the date and time for older messages", () => {
    const value = formatMessageTimestamp(
      { metadata: { createdAt: "2026-07-10T18:30:00-07:00" } },
      new Date("2026-07-11T20:00:00-07:00"),
    )
    expect(value).toContain("2026")
    expect(value).toMatch(/Jul|07/)
  })
})
