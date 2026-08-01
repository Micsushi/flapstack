import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string) {
  return readFileSync(path, "utf8")
}

describe("visual capture renderer and run integration contract", () => {
  it("adds the confirmed derivative to the real composer image pipeline with its immutable marker", () => {
    const input = source("src/renderer/features/agents/main/chat-input-area.tsx")
    const dialog = source("src/renderer/features/agents/ui/visual-capture-dialog.tsx")
    expect(input).toMatch(/<VisualCaptureDialog[\s\S]*onAddAttachments=\{onAddAttachments\}/)
    expect(dialog).toContain("onAddAttachments")
    expect(dialog).toContain("flapstack-visual-")
    expect(dialog).toMatch(/new File\(/)
  })

  it("binds marked images after each supported run identity exists", () => {
    const claude = source("src/main/lib/trpc/routers/claude.ts")
    const codex = source("src/main/lib/trpc/routers/codex.ts")
    const direct = source("src/main/lib/trpc/routers/agent-runtime-chat.ts")
    for (const implementation of [claude, codex, direct]) {
      expect(implementation).toContain("bindVisualCaptureImagesToRun")
      expect(implementation).toMatch(/bindVisualCaptureImagesToRun\(\{[\s\S]*images:/)
    }
  })
})
