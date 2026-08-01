import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("feature visibility production controls", () => {
  it("guards optional Chat and new-Chat controls with the authoritative visibility state", () => {
    const composer = read("../src/renderer/features/agents/main/chat-input-area.tsx")
    const newChat = read("../src/renderer/features/agents/main/new-chat-form.tsx")

    for (const featureId of ["agent-profiles", "runtimes", "voice", "visual-context"]) {
      expect(`${composer}\n${newChat}`).toContain(`featureVisibility.isVisible("${featureId}")`)
    }
    expect(composer).toContain('hidden={!featureVisibility.isVisible("visual-context")}')
    expect(composer).toMatch(
      /featureVisibility\.isVisible\("voice"\)\s*&&\s*\(\s*<AgentVoiceButton/,
    )
    expect(newChat).toMatch(/featureVisibility\.isVisible\("voice"\)\s*&&\s*\(\s*<AgentVoiceButton/)
    expect(newChat).toContain('featureVisibility.isVisible("agent-profiles") &&')
    expect(newChat).toContain('featureVisibility.isVisible("runtimes") &&')
  })
})
