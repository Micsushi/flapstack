import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const activeChatSource = readFileSync(
  join(process.cwd(), "src", "renderer", "features", "agents", "main", "active-chat.tsx"),
  "utf8",
)

describe("renderer cross-provider continuation authority", () => {
  it("uses the durable top-level Runtime continuation endpoint", () => {
    const start = activeChatSource.indexOf("const handleContinueWithProvider = useCallback")
    const end = activeChatSource.indexOf("const handleDelegateWithProvider", start)
    const handler = activeChatSource.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(handler).toContain("previewRuntimeContinuation")
    expect(handler).toContain("continueWithRuntime")
    expect(handler).toContain("targetModel")
    expect(handler).toContain("confirmedPreviewDigest: preview.digest")
    expect(handler).toContain("Continue with ${modelName}?")
    expect(handler).toContain("formatModelDisplayName(preview.targetSnapshot.model)")
    expect(handler).toContain("Provider: ${preview.targetSnapshot.harness}")
    expect(handler).toContain("Messages to include:")
    expect(handler).toContain("Permission:")
    expect(handler).toContain("Network:")
    expect(handler).toContain("Worktree: ${worktreeName}")
    expect(handler).not.toContain("Preview digest:")
    expect(handler).toContain("if (!confirmed)")
    expect(handler).not.toContain("writePastedText")
    expect(handler).not.toContain("createSubChat")
    expect(handler).not.toContain("pendingChatHistoryAtom")
  })

  it("requires an explicit cross-provider target preview instead of a remembered bypass", () => {
    const selector = readFileSync(
      join(
        process.cwd(),
        "src",
        "renderer",
        "features",
        "agents",
        "components",
        "agent-model-selector.tsx",
      ),
      "utf8",
    )

    expect(selector).toContain("targetModelId")
    expect(selector).toContain("Selected model")
    expect(selector).not.toContain("skip-cross-provider-dialog")
    expect(selector).not.toContain("Don't ask again")
  })
})
