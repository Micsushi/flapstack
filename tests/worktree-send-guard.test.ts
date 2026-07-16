import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("stale worktree send guard", () => {
  it("blocks button and keyboard submission with a durable recovery message", () => {
    const source = readFileSync("src/renderer/features/agents/main/chat-input-area.tsx", "utf8")

    expect(source).toContain('toast.error("Checkout unavailable"')
    expect(source).toContain("if (worktreeBlockedReason)")
    expect(source).toContain("Boolean(worktreeBlockedReason)")
    expect(source).toContain("Fix automatically uses the project checkout when available")
    expect(source).toContain("otherwise this Chat continues without project files")
    expect(source).toContain("Fix automatically")
    expect(source).toContain("Choose a repository instead")
    expect(source).toContain("This Chat still works, but it has no project files")
    expect(source).toContain("repairUnavailableCheckoutMutation")
    expect(source).toContain('"Choose repository"')
    expect(source).toContain("No Chats were changed.")
  })
})
