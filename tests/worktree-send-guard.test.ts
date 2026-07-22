import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function readSource(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}

describe("stale worktree send guard", () => {
  it("blocks button and keyboard submission with a durable recovery message", () => {
    const source = readSource("src/renderer/features/agents/main/chat-input-area.tsx")

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

    const queueSource = readSource("src/renderer/features/agents/components/queue-processor.tsx")
    expect(queueSource).toContain("resolveWorktreeStatus.query")
    expect(queueSource).toContain('checkout.status === "unknown" || checkout.status === "replaced"')
    expect(queueSource).toContain("if (!parentChatId) {\n        scheduleProcessing(subChatId)")
    expect(queueSource.indexOf("resolveWorktreeStatus.query")).toBeLessThan(
      queueSource.indexOf("popItem"),
    )

    const resolverSource = readSource("src/main/lib/worktree-resolver.ts")
    expect(resolverSource).toContain("REPLACED_FILESYSTEM_ROOT_MESSAGE")

    const watcherBridgeSource = readSource("src/main/lib/git/watcher/ipc-bridge.ts")
    expect(watcherBridgeSource).toContain('return { status: "blocked", reason }')
    expect(watcherBridgeSource).toContain("REPLACED_FILESYSTEM_ROOT_MESSAGE")

    const watcherHookSource = readSource("src/renderer/lib/hooks/use-file-change-listener.ts")
    expect(watcherHookSource).toContain('result?.status === "blocked"')
    expect(watcherHookSource).toContain("result.reason")
  })
})
