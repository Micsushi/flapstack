import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * `api.agents.getAgentChat` is a hand-written adapter: the hook reads one tRPC
 * query while `useUtils()` writes to another. Nothing type-checks that pairing,
 * which is how the two silently drifted onto different cache keys and made every
 * optimistic update and invalidation a no-op. Pin the invariant here.
 */
const source = readFileSync("src/renderer/lib/mock-api.ts", "utf8")

function readQueryProcedure(): string {
  const match = source.match(/getAgentChat:\s*\{\s*useQuery[\s\S]*?trpc\.chats\.(\w+)\.useQuery/)
  if (!match) throw new Error("could not find the getAgentChat query procedure")
  return match[1]
}

function utilsProcedures(): string[] {
  const utilsSection = source.slice(source.indexOf("useUtils: () =>"))
  const adapterStart = utilsSection.indexOf("getAgentChat: {")
  const adapter = utilsSection.slice(adapterStart, utilsSection.indexOf("getSubChats: {"))
  return Array.from(adapter.matchAll(/utils\.chats\.(\w+)\./g), (match) => match[1])
}

describe("chat metadata cache key", () => {
  it("reads and writes the same query", () => {
    const queryProcedure = readQueryProcedure()
    const writeProcedures = utilsProcedures()

    expect(queryProcedure).toBe("getMetadata")
    expect(writeProcedures.length).toBeGreaterThanOrEqual(4)
    for (const procedure of writeProcedures) {
      expect(procedure).toBe(queryProcedure)
    }
  })

  it("passes the same input shape on both sides", () => {
    expect(source).toMatch(/trpc\.chats\.getMetadata\.useQuery\(\s*\{ id: chatId! \},/)
    expect(source).toContain("utils.chats.getMetadata.setData({ id: args.chatId }, updater)")
    expect(source).toContain("utils.chats.getMetadata.invalidate({ id: args.chatId })")
  })

  it("does not write transcripts into the metadata cache", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    // getMetadata omits the `messages` column; getTranscript owns transcripts.
    expect(activeChat).not.toMatch(
      /getAgentChat\.setData\([^)]*\)[\s\S]{0,400}?messages: latestMessagesJson/,
    )
    expect(activeChat).toContain("trpcUtils.chats.getTranscript.setData")
  })

  it("keeps the chat loading gate closed until its first transcript arrives", () => {
    const activeChat = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")

    expect(activeChat).toContain("isLoading: isTranscriptLoading")
    expect(activeChat).toMatch(
      /const isLocalChatLoading =[\s\S]*?isTranscriptLoading &&[\s\S]*?!agentChatStore\.has/,
    )
  })

  it("primes a newly created chat before selecting it", () => {
    const newChatForm = readFileSync("src/renderer/features/agents/main/new-chat-form.tsx", "utf8")
    const metadataWrite = newChatForm.indexOf("utils.chats.getMetadata.setData")
    const transcriptWrite = newChatForm.indexOf("utils.chats.getTranscript.setData")
    const selection = newChatForm.indexOf("setSelectedChatId(data.id)")

    expect(metadataWrite).toBeGreaterThan(-1)
    expect(transcriptWrite).toBeGreaterThan(-1)
    expect(metadataWrite).toBeLessThan(selection)
    expect(transcriptWrite).toBeLessThan(selection)
    expect(newChatForm).toContain("messages: _messages")
  })
})
