import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const titleEditorSource = readFileSync(
  "src/renderer/features/agents/ui/chat-title-editor.tsx",
  "utf8",
)

describe("chat switch motion", () => {
  it("does not scale inactive conversations", () => {
    expect(activeChatSource).not.toContain("scale(0.98)")
    expect(activeChatSource).not.toContain('willChange: "transform, opacity"')
  })

  it("renders stored header titles without typewriter replay", () => {
    expect(titleEditorSource).not.toContain("TypewriterText")
    expect(titleEditorSource).not.toContain("justCreatedIdsAtom")
  })
})
