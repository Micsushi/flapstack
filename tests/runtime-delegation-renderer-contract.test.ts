import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("renderer cross-provider delegation contract", () => {
  it("offers delegation from an exact cross-provider model choice and confirms the preview", () => {
    const selector = readFileSync(
      resolve("src/renderer/features/agents/components/agent-model-selector.tsx"),
      "utf8",
    )
    const chat = readFileSync(resolve("src/renderer/features/agents/main/active-chat.tsx"), "utf8")

    expect(selector).toContain("Delegate task")
    expect(selector).toContain("onDelegateWithProvider")
    expect(chat).toContain("previewRuntimeDelegation.query")
    expect(chat).toContain("Confirm exact cross-provider delegation")
    expect(chat).toContain("confirmedPreviewDigest: preview.digest")
    expect(chat).toContain("delegateToRuntime.mutate")
    expect(chat).toContain("created.childChatId")
  })
})
