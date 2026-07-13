import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const atomsSource = readFileSync("src/renderer/features/agents/atoms/index.ts", "utf8")
const messageGroupSource = readFileSync(
  "src/renderer/features/agents/main/isolated-message-group.tsx",
  "utf8",
)

describe("floating user message preference", () => {
  it("persists a global enabled-by-default preference", () => {
    expect(atomsSource).toContain('"agents:floatingUserMessages"')
    expect(atomsSource).toMatch(/floatingUserMessagesAtom = atomWithStorage<boolean>\([\s\S]*?true/)
  })

  it("offers the toggle from both the overflow and context menus", () => {
    expect(messageGroupSource).toContain("<DropdownMenu>")
    expect(messageGroupSource).toContain("<ContextMenu>")
    expect(messageGroupSource).toContain('"Stop floating prompts"')
    expect(messageGroupSource).toContain('"Make prompts float"')
  })

  it("only applies sticky positioning while enabled", () => {
    expect(messageGroupSource).toContain('floatingUserMessages && "sticky z-10"')
    expect(messageGroupSource).toContain("floatingUserMessages && stickyTopClass")
  })

  it("offers a jump-back button only when a prompt is pinned", () => {
    expect(messageGroupSource).toContain("isPinned &&")
    expect(messageGroupSource).toContain('aria-label="Jump to this prompt"')
    expect(messageGroupSource).toContain("messageAnchorRef")
    expect(messageGroupSource).toContain("new IntersectionObserver")
    expect(messageGroupSource).not.toContain('addEventListener("scroll"')
    expect(messageGroupSource).toContain("scrollContainer.scrollTo({")
    expect(messageGroupSource).toContain("scrollContainer.scrollTop + anchorTop - containerTop - 8")
  })

  it("keeps long-chat content visibility optimization enabled", () => {
    expect(messageGroupSource).not.toContain("hasStickyContent={floatingUserMessages}")
    const activeChatSource = readFileSync(
      "src/renderer/features/agents/main/active-chat.tsx",
      "utf8",
    )
    expect(activeChatSource).toMatch(/!isLastGroup\s*&&\s*\{/)
    expect(activeChatSource).toContain('contentVisibility: "auto"')
  })
})
