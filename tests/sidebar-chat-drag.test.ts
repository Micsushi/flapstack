import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { shouldPopOutChatDrag } from "../src/renderer/features/agents/lib/chat-drag-feedback"

const read = (path: string) => readFileSync(path, "utf8")

describe("sidebar Chat drag handoff", () => {
  it("only treats a meaningful uncancelled drag outside a drop target as a pop-out", () => {
    const session = { screenX: 100, screenY: 100, cancelled: false }

    expect(
      shouldPopOutChatDrag(session, {
        dropEffect: "none",
        screenX: 160,
        screenY: 160,
      }),
    ).toBe(true)
    expect(
      shouldPopOutChatDrag(session, {
        dropEffect: "move",
        screenX: 160,
        screenY: 160,
      }),
    ).toBe(false)
    expect(
      shouldPopOutChatDrag(
        { ...session, cancelled: true },
        {
          dropEffect: "none",
          screenX: 160,
          screenY: 160,
        },
      ),
    ).toBe(false)
    expect(
      shouldPopOutChatDrag(session, {
        dropEffect: "none",
        screenX: 105,
        screenY: 105,
      }),
    ).toBe(false)
  })

  it("routes sidebar drags through the taskbar and outside-window handoffs", () => {
    const sidebar = read("src/renderer/features/sidebar/agents-sidebar.tsx")
    const content = read("src/renderer/features/agents/ui/agents-content.tsx")

    expect(sidebar).toContain("CHAT_WORKBENCH_SIDEBAR_DRAG_START_EVENT")
    expect(sidebar).toContain("CHAT_WORKBENCH_SIDEBAR_DRAG_END_EVENT")
    expect(sidebar).toContain("projectId: chatProjectId || undefined")
    expect(content).toContain("openSidebarChatOnMainBar")
    expect(content).toContain("dropChatOutside(session.source")
  })
})
