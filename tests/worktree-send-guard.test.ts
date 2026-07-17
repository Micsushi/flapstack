import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("stale worktree send guard", () => {
  it("blocks button and keyboard submission with a durable recovery message", () => {
    const source = readFileSync("src/renderer/features/agents/main/chat-input-area.tsx", "utf8")

    expect(source).toContain(
      'worktreeWasReplaced ? "Checkout was replaced" : "Checkout unavailable"',
    )
    expect(source).toContain("if (worktreeBlockedReason)")
    expect(source).toContain("Boolean(worktreeBlockedReason)")
    expect(source).toContain("Fix automatically uses the project checkout when available")
    expect(source).toContain("otherwise this Chat continues without project files")
    expect(source).toContain("Fix automatically")
    expect(source).toContain("Review and reconnect")
    expect(source).toContain("reconnectReplacedCheckoutMutation")
    expect(source).toContain("Choose a repository instead")
    expect(source).toContain("This Chat still works, but it has no project files")
    expect(source).toContain("repairUnavailableCheckoutMutation")
    expect(source).toContain('"Choose repository"')
    expect(source).toContain("No Chats were changed.")

    const queueSource = readFileSync(
      "src/renderer/features/agents/components/queue-processor.tsx",
      "utf8",
    )
    expect(queueSource).toContain("resolveWorktreeStatus.query")
    expect(queueSource).toContain('checkout.status === "unknown" || checkout.status === "replaced"')
    expect(queueSource).toContain("if (!parentChatId) {\n        scheduleProcessing(subChatId)")
    expect(queueSource.indexOf("resolveWorktreeStatus.query")).toBeLessThan(
      queueSource.indexOf("popItem"),
    )

    const resolverSource = readFileSync("src/main/lib/worktree-resolver.ts", "utf8")
    expect(resolverSource).toContain("REPLACED_FILESYSTEM_ROOT_MESSAGE")

    const watcherBridgeSource = readFileSync("src/main/lib/git/watcher/ipc-bridge.ts", "utf8")
    expect(watcherBridgeSource).toContain('return { status: "blocked", reason }')
    expect(watcherBridgeSource).toContain("REPLACED_FILESYSTEM_ROOT_MESSAGE")

    const watcherHookSource = readFileSync(
      "src/renderer/lib/hooks/use-file-change-listener.ts",
      "utf8",
    )
    expect(watcherHookSource).toContain('result?.status === "blocked"')
    expect(watcherHookSource).toContain("result.reason")
  })
})
