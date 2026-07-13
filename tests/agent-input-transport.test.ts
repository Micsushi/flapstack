// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { appStore } from "../src/renderer/lib/jotai-store"
import {
  askUserQuestionResultsAtom,
  expiredUserQuestionsAtom,
  pendingUserQuestionsAtom,
} from "../src/renderer/features/agents/atoms"
import { handleAgentInputChunk } from "../src/renderer/features/agents/lib/agent-input-transport"
import type { AgentInputRequest } from "../src/shared/agent-input"

function request(overrides: Partial<AgentInputRequest> = {}): AgentInputRequest {
  return {
    requestId: "request-1",
    chatId: "sub-chat-1",
    runId: "run-1",
    origin: { harness: "codex" },
    capability: {
      mode: "continuation",
      sameRun: false,
      limitation: "Normal continuation only.",
    },
    questions: [
      {
        id: "question-1",
        question: "Choose one",
        options: [{ id: "alpha", label: "Alpha" }],
        multiSelect: false,
        allowCustom: true,
      },
    ],
    status: "pending",
    createdAt: 1,
    ...overrides,
  }
}

const context = { chatId: "chat-1", subChatId: "sub-chat-1" }

beforeEach(() => {
  appStore.set(pendingUserQuestionsAtom, new Map())
  appStore.set(expiredUserQuestionsAtom, new Map())
  appStore.set(askUserQuestionResultsAtom, new Map())
})

describe("provider-neutral agent input transport", () => {
  it.each(["codex", "cursor-agent", "openrouter", "nanogpt"] as const)(
    "accepts %s continuation requests without provider-specific renderer state",
    (harness) => {
      expect(
        handleAgentInputChunk(
          { type: "agent-input-request", request: request({ origin: { harness } }) },
          context,
        ),
      ).toBe(true)
      expect(appStore.get(pendingUserQuestionsAtom).get("sub-chat-1")).toMatchObject({
        toolUseId: "request-1",
        request: { origin: { harness }, capability: { mode: "continuation" } },
        questions: [{ id: "question-1", allowCustom: true }],
      })
    },
  )

  it("keeps a request pending across unrelated stream chunks until a terminal status", () => {
    handleAgentInputChunk({ type: "agent-input-request", request: request() }, context)
    expect(handleAgentInputChunk({ type: "text-delta", delta: "later" }, context)).toBe(false)
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-chat-1")).toBe(true)

    handleAgentInputChunk(
      {
        type: "agent-input-status",
        event: {
          requestId: "request-1",
          chatId: "sub-chat-1",
          runId: "run-1",
          status: "answered",
          at: 2,
          response: {
            requestId: "request-1",
            mode: "structured",
            answers: { "question-1": ["Alpha"] },
            submittedAt: 2,
          },
        },
      },
      context,
    )

    expect(appStore.get(pendingUserQuestionsAtom).has("sub-chat-1")).toBe(false)
    expect(appStore.get(askUserQuestionResultsAtom).get("request-1")).toEqual({
      answers: { "Choose one": "Alpha" },
    })
  })

  it("rejects cross-chat request routing and retains expired requests as continuations", () => {
    expect(
      handleAgentInputChunk(
        { type: "agent-input-request", request: request({ chatId: "other-chat" }) },
        context,
      ),
    ).toBe(false)

    handleAgentInputChunk({ type: "agent-input-request", request: request() }, context)
    expect(
      handleAgentInputChunk(
        {
          type: "agent-input-status",
          event: {
            requestId: "request-1",
            chatId: "other-chat",
            runId: "run-1",
            status: "cancelled",
            at: 2,
          },
        },
        context,
      ),
    ).toBe(false)
    expect(appStore.get(pendingUserQuestionsAtom).has("sub-chat-1")).toBe(true)

    handleAgentInputChunk(
      {
        type: "agent-input-status",
        event: {
          requestId: "request-1",
          chatId: "sub-chat-1",
          runId: "run-1",
          status: "expired",
          at: 2,
          message: "Expired",
        },
      },
      context,
    )
    expect(appStore.get(expiredUserQuestionsAtom).get("sub-chat-1")?.toolUseId).toBe("request-1")
  })
})
