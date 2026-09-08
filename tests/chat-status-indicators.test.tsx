import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  ChatStatusIndicators,
  ChatStatusProvider,
  ChatStatusSummary,
} from "../src/renderer/features/agents/ui/chat-status-indicators"
import { outcomeLabels, type WorkOutcome } from "../src/renderer/features/agents/lib/chat-status"

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    chats: {
      listAgentMetadata: {
        useQuery: () => ({
          data: {
            runStatuses: [
              { id: "sub-a", chatId: "a", runStatus: "failure" },
              { id: "sub-b", chatId: "b", runStatus: "success" },
            ],
          },
        }),
      },
    },
  },
}))
vi.mock("../src/renderer/features/agents/atoms", async () => {
  const { atom } = await import("jotai")
  return {
    agentsUnseenChangesAtom: atom(new Set(["a"])),
    loadingSubChatsAtom: atom(new Map([["sub-b", "b"]])),
    pendingPlanApprovalsAtom: atom(new Map()),
    pendingUserQuestionsAtom: atom(new Map([["sub-a", { parentChatId: "a" }]])),
  }
})

describe("Chat status accessibility", () => {
  it("combines persisted run truth with independent live input, runtime, and unread", () => {
    const html = renderToStaticMarkup(
      <ChatStatusProvider>
        <ChatStatusIndicators chatIds={["a", "b", "a"]} />
      </ChatStatusProvider>,
    )
    expect(html).toContain(
      "1 unread; 1 running; 1 needs help or input; Run failed; work not verified; Work outcome unknown",
    )
    expect(html).not.toContain("Verified work complete")
  })
  it.each(Object.keys(outcomeLabels) as WorkOutcome[])(
    "labels %s independently of unread and running",
    (outcome) => {
      for (const unread of [false, true]) {
        const html = renderToStaticMarkup(
          <ChatStatusSummary statuses={[{ unread, running: true, needsHelp: true, outcome }]} />,
        )
        expect(html).toContain('role="img"')
        expect(html).toContain(outcomeLabels[outcome])
        expect(html).toContain(unread ? "1 unread" : "Read")
        expect(html).toContain("1 running")
        expect(html).toContain("1 needs help or input")
        expect(html).toContain("motion-safe:animate-spin")
      }
    },
  )

  it("preserves incomplete and unknown members beside verified members", () => {
    const html = renderToStaticMarkup(
      <ChatStatusSummary
        statuses={[
          { unread: false, running: false, needsHelp: false, outcome: "verified-complete" },
          { unread: true, running: false, needsHelp: false, outcome: "unknown" },
          { unread: false, running: false, needsHelp: false, outcome: "stopped-incomplete" },
        ]}
      />,
    )
    expect(html).toContain("Work outcome unknown")
    expect(html).toContain("Agent stopped; work incomplete")
    expect(html).toContain("Verified work complete")
  })
})
