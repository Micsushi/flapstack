import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("permission UI contract", () => {
  it("asks for scope before an unremembered chat permission change", () => {
    const source = readSource("src/renderer/features/agents/main/chat-input-area.tsx")
    expect(source).toContain('if (behavior === "ask")')
    expect(source).toContain('setPendingPermissionScope("all-chats")')
    expect(source).toContain("Change chat permissions?")
    expect(source).toContain("Remember my choice")
    expect(source).toContain("This chat only")
    expect(source).toContain('pendingPermissionMode === "full-access"')
    expect(source).toContain("permissionConfirmationInFlightRef.current")
  })

  it("requires an explicit complete custom capability review before any all-chat apply", () => {
    const source = readSource("src/renderer/features/agents/main/chat-input-area.tsx")
    expect(source).toContain('if (mode === "custom")')
    expect(source).toContain("setPendingCustomReviewed(false)")
    expect(source).toContain("Review the exact capabilities before applying Custom")
    expect(source).toContain("I reviewed this complete capability set.")
    expect(source).toContain('pendingPermissionMode === "custom" && !pendingCustomReviewed')
    expect(source).toContain("permissionResolution?.customPermissions ?? disabledCustomPermissions")
  })

  it("keeps direct Settings edits scoped to one named chat", () => {
    const source = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-permissions-tab.tsx",
    )
    expect(source).toContain("Ask every time")
    expect(source).toContain("Always all chats")
    expect(source).toContain("Always this chat")
    expect(source).toContain('scope: "current-chat"')
    expect(source).toContain("Default permission")
    expect(source).toContain("Filter chats, projects, or tasks")
  })

  it("keeps runtime first below both inputs and puts new-chat targets above", () => {
    const activeChat = readSource("src/renderer/features/agents/main/chat-input-area.tsx")
    const newChat = readSource("src/renderer/features/agents/main/new-chat-form.tsx")
    const chatsRouter = readSource("src/main/lib/trpc/routers/chats.ts")

    for (const surface of [activeChat, newChat]) {
      expect(surface.indexOf("<RuntimeSelector")).toBeLessThan(
        surface.indexOf("<PermissionSelector"),
      )
      expect(surface.indexOf("<PermissionSelector")).toBeLessThan(
        surface.indexOf("<AgentModeSelector"),
      )
    }
    expect(newChat).toContain("Target selectors - directly above input")
    expect(newChat).toContain(
      "(agentProfileSelection?.permissionMode as NewChatPermissionMode | undefined) ??",
    )
    expect(newChat).toContain("permissionModeOverride ??")
    expect(chatsRouter).toContain("permissionMode: newChatPermissionModeSchema.optional()")
    expect(chatsRouter).toContain("permissionMode: input.permissionMode ?? inheritedMode")
  })

  it("updates Settings search on the input change event", () => {
    const source = readSource("src/renderer/features/settings/settings-sidebar.tsx")
    expect(source).toContain("onChange={(event) => setSearchQuery(event.target.value)}")
    expect(source).toContain('event.key.toLowerCase() === "f"')
    expect(source).toContain('event.key === "ArrowDown"')
    expect(source).toContain('event.key === "Enter"')
  })

  it("keeps Settings navigation visible when the chat sidebar is closed", () => {
    const source = readSource("src/renderer/features/layout/agents-layout.tsx")
    expect(source).toContain("isOpen={!isMobile && (isSettingsView || sidebarOpen)}")
  })
})
