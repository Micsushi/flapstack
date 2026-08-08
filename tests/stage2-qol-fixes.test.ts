import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Stage 2 QOL regression contracts", () => {
  it("keeps the changed-files card outside collapsed reasoning", () => {
    const source = readSource("src/renderer/features/agents/main/assistant-message-item.tsx")
    expect(source).toContain("        {!isStreaming && <AgentChangedFilesCard")
    expect(source).not.toMatch(
      /<ReasoningTimeline[\s\S]*?<AgentChangedFilesCard[\s\S]*?<\/ReasoningTimeline>/,
    )
  })

  it("collapses a single tool activity inside reasoning", () => {
    const source = readSource("src/renderer/features/agents/main/assistant-message-item.tsx")
    expect(source).toContain(
      'if (current.length >= 1) result.push({ type: "activity-group", parts: current })',
    )
    expect(source).not.toContain(
      'if (current.length >= 2) result.push({ type: "activity-group", parts: current })',
    )
  })

  it("mirrors user message actions in the assistant response row", () => {
    const source = readSource("src/renderer/features/agents/main/assistant-message-item.tsx")
    const actions = source.slice(
      source.indexOf("{hasTextContent && (!isStreaming || !isLastMessage)"),
      source.indexOf("{/* Git activity badges */}"),
    )

    const menuIndex = actions.indexOf('aria-label="Assistant message options"')
    const copyIndex = actions.indexOf("<CopyButton")
    const playIndex = actions.indexOf("<PlayButton")
    const timestampIndex = actions.indexOf("{timestamp &&")

    expect(menuIndex).toBeGreaterThanOrEqual(0)
    expect(menuIndex).toBeLessThan(copyIndex)
    expect(copyIndex).toBeLessThan(playIndex)
    expect(playIndex).toBeLessThan(timestampIndex)
    expect(actions).toContain('<DropdownMenuContent align="start"')
  })

  it("requests the selected stored-diff scope", () => {
    const card = readSource("src/renderer/features/agents/ui/agent-changed-files-card.tsx")
    const router = readSource("src/main/lib/trpc/routers/runs.ts")
    const undo = readSource("src/main/lib/run-change-undo.ts")
    expect(card).toContain("filePath: reviewFilePath")
    expect(router).toContain("filePath: z.string().optional()")
    expect(undo).toContain(":(literal)${filePath}")
  })

  it("snapshots the reasoning default for the created conversation", () => {
    const source = readSource("src/renderer/features/agents/main/new-chat-form.tsx")
    expect(source).toContain("subChatReasoningEnabledAtomFamily(firstSubChatId)")
    expect(source).toContain("pendingReasoningEnabledRef.current = reasoningOutputEnabled")
  })

  it("retains transcription rows when old audio is pruned", () => {
    const source = readSource("src/main/lib/speech/history.ts")
    expect(source).toContain("isNotNull(voiceArtifacts.audioPath)")
    expect(source).toContain('if (row.kind === "transcription")')
    expect(source).toContain(".set({ audioPath: null, mimeType: null, byteLength: 0 })")
  })

  it("uses an error-propagating stream pipeline for the model download", () => {
    const source = readSource("src/main/lib/speech/stt-parakeet-streaming.ts")
    expect(source).toContain('import { pipeline } from "node:stream/promises"')
    expect(source).toContain("await pipeline(")
    expect(source).not.toContain("const output = createWriteStream(temporary)")
  })
})
