import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const agentsContent = readFileSync("src/renderer/features/agents/ui/agents-content.tsx", "utf8")
const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const newChatForm = readFileSync("src/renderer/features/agents/main/new-chat-form.tsx", "utf8")
const preferences = readFileSync(
  "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
  "utf8",
)

describe("main task bar actions", () => {
  it("adds a trailing new-Chat button that uses the last messaged project", () => {
    expect(agentsContent).toContain("data-main-taskbar-new-chat")
    expect(agentsContent).toContain("border-transparent bg-transparent")
    expect(agentsContent).toContain("hover:border-border/60 hover:bg-accent hover:text-foreground")
    expect(agentsContent).toContain("lastMessagedProjectIdAtom")
    expect(agentsContent).toContain("Open a new Chat")
    expect(activeChat).toContain("lastMessagedProjectIdAtom")
    expect(newChatForm).toContain("lastMessagedProjectIdAtom")
  })

  it("offers both group-close outcomes and exposes the remembered choice in Settings", () => {
    expect(agentsContent).toContain("Close all Chats")
    expect(agentsContent).toContain("Keep Chats on main bar")
    expect(agentsContent).toContain("Always use this choice")
    expect(agentsContent).toContain("groupCloseBehaviorAtom")
    expect(preferences).toContain('data-settings-id="preferences-group-close"')
    expect(preferences).toContain("Ask every time")
  })
})
