import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("new chat tab lifecycle", () => {
  it("keeps the main tab strip around the new-chat form", () => {
    const content = read("src/renderer/features/agents/ui/agents-content.tsx")

    expect(content).toContain("selectedChatId || selectedDraftId || showNewChatForm")
    expect(content).toContain("data-open-draft-tab-id")
    expect(content).toContain('data-new-chat-tab="true"')
    expect(content).toContain("onDraftIdChange")
  })

  it("offers a persisted draft reminder preference", () => {
    const atoms = read("src/renderer/lib/atoms/index.ts")
    const settings = read(
      "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
    )
    const sidebar = read("src/renderer/features/sidebar/agents-sidebar.tsx")

    expect(atoms).toContain("newChatDraftReminderEnabledAtom")
    expect(settings).toContain("Unsent draft reminders")
    expect(sidebar).toContain("unsent draft")
    expect(sidebar).toContain("Don't remind me")
  })
})
