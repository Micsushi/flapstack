import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("composer settings layout", () => {
  it("keeps settings inside the measured composer flow and collapses started chats", () => {
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")

    expect(composer).toContain("forceOverflow={hasStartedChat}")
    expect(composer).toContain("overflowLabels={composerSettingLabels}")
    expect(composer).not.toContain('className="absolute inset-x-0 top-[calc(100%+18px)]')
    expect(composer).not.toContain('"mb-9 border bg-input-background')
  })

  it("renders overflowed settings as labeled option rows", () => {
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")
    const overflow = read("src/renderer/components/progressive-overflow-row.tsx")

    expect(overflow).toContain('overflowLayout?: "wrap" | "rows"')
    expect(composer).toContain('overflowLayout="rows"')
    expect(overflow).toContain("overflowLabels?.[index]")
    expect(overflow).toContain("grid-cols-[88px_minmax(0,1fr)]")
  })

  it("locks immutable launch settings after the first message", () => {
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")
    const runtime = read("src/renderer/features/agents/runtime-settings/runtime-selector.tsx")
    const profile = read("src/renderer/features/agent-profiles/chat-agent-profile-control.tsx")

    expect(composer).toContain("const hasStartedChat = messageTokenData.messageCount > 0")
    expect(composer).toContain("locked={hasStartedChat}")
    expect(runtime).toContain("Runtime locked after the first message")
    expect(profile).toContain("const isLocked = locked || binding.data?.frozen === true")
    expect(profile).toContain("Agent Profile locked after the first message")
  })

  it("combines composer additions and modes behind one plus menu", () => {
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")
    const commands = read("src/renderer/features/agents/commands/builtin-commands.ts")

    expect(composer).toContain('aria-label="Add to chat"')
    expect(composer).toContain("Add files")
    expect(composer).toContain("Add screen or window")
    expect(composer).toContain("Plan mode")
    expect(composer).toContain("Set a goal")
    expect(composer).toContain("editorRef.current?.getValue().trim()")
    expect(composer).not.toContain('aria-label="Attach files"')
    expect(composer).not.toContain("SpeechVocabularyPopover")
    expect(commands).toContain('name: "goal"')
  })

  it("uses equal control boxes and one shared gap for composer actions", () => {
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")

    expect(composer).toMatch(/<AgentContextIndicator[\s\S]*?className="h-7 w-7"/)
    expect(composer).toContain("gap={2}")
    expect(composer).not.toMatch(/<div className="ml-0\.5">\s*<AgentSendButton/)
  })
})
