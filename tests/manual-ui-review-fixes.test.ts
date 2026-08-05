import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("manual UI review fixes", () => {
  it("keeps failed runs failed and renders their provider error inline", () => {
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    expect(activeChat).toContain('setStatus(subChatId, "error")')
    expect(activeChat).toContain('status === "error"')
    expect(activeChat).toContain("presentRunError")
    expect(activeChat).toContain("technicalDetail")
  })

  it("uses an always-available transcript rail without a ready status capsule", () => {
    const overview = read("src/renderer/features/agents/main/chat-transcript-overview.tsx")
    expect(overview).toContain('aria-label="Transcript timeline"')
    expect(overview).toContain("group-hover/marker:block")
    expect(overview).toContain("left-1.5")
    expect(overview).toContain("promptPreview")
    expect(overview).not.toContain("right-1.5")
    expect(overview).not.toContain("ProgressCapsule")
    expect(overview).not.toContain("Popover")
  })

  it("keeps floating prompts out of transformed virtual groups", () => {
    const messages = read("src/renderer/features/agents/main/isolated-messages-section.tsx")
    expect(messages).toContain("top: `${virtualItem.start - scrollMargin}px`")
    expect(messages).not.toContain("transform: `translateY(${virtualItem.start")
  })

  it("shows lightweight in-transcript startup feedback and a real load state", () => {
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    expect(activeChat).toContain('const STREAMING_WORDS = ["Thinking", "Working", "Cooking"]')
    expect(activeChat).toContain("Loading chat…")
    expect(activeChat).toContain('refetchOnMount: "always"')
  })

  it("provides native-feeling paste and mouse-back navigation", () => {
    const editor = read("src/renderer/features/agents/mentions/agents-mentions-editor.tsx")
    const layout = read("src/renderer/features/layout/agents-layout.tsx")
    expect(editor).toContain("navigator.clipboard")
    expect(editor).toContain("Paste")
    expect(layout).toContain("event.button !== 3")
    expect(layout).toContain("lastChatIdRef.current")
  })

  it("keeps quick-access categories visible and removes duplicate sidebar branding", () => {
    const sidebar = read("src/renderer/features/sidebar/agents-sidebar.tsx")
    expect(sidebar).toContain('title="Quick access"')
    expect(sidebar).toContain('title: "Pinned"')
    expect(sidebar).toContain('title: "Starred"')
    expect(sidebar).toContain("No drafts")
    expect(sidebar).not.toContain("flapstackAppIcon")
  })

  it("uses fixed-width colored tabs with hover close and named collapsible groups", () => {
    const workbench = read("src/renderer/features/agents/workbench/chat-workbench.tsx")
    expect(workbench).toContain("h-8 w-44 shrink-0")
    expect(workbench).toContain("borderTopColor: chatAccents.get(chatId)")
    expect(workbench).toContain("group-hover/tab:opacity-100")
    expect(workbench).toContain("groupPresentation.collapsed")
    expect(workbench).toContain("Rename group…")
  })
})
