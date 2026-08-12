import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const appSource = readFileSync(resolve("src/renderer/App.tsx"), "utf8")
const agentsContentSource = readFileSync(
  resolve("src/renderer/features/agents/ui/agents-content.tsx"),
  "utf8",
)

describe("desktop notification navigation", () => {
  it("handles notification clicks at app scope and restores the chat project", () => {
    expect(appSource).toContain("onNotificationClicked")
    expect(appSource).toMatch(/trpcUtils\.chats\.getMetadata\s*\.fetch\(\{ id: chatId \}\)/)
    expect(appSource).toContain("setSelectedProject({")
    expect(appSource).toContain("setSelectedChatId(chatId)")
  })

  it("queues sub-chat navigation through the durable store path", () => {
    expect(appSource).toContain("queueNavigation(chatId, subChatId)")
    expect(agentsContentSource).not.toContain("pendingNotificationNavigationRef")
  })
})
