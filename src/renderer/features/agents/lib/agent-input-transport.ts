import type {
  AgentInputOption,
  AgentInputQuestion,
  AgentInputRequest,
  AgentInputStatusEvent,
} from "../../../../shared/agent-input"
import { appStore } from "../../../lib/jotai-store"
import {
  askUserQuestionResultsAtom,
  expiredUserQuestionsAtom,
  pendingUserQuestionsAtom,
  type PendingUserQuestions,
} from "../atoms"

type AgentInputChunk =
  | { type: "agent-input-request"; request: AgentInputRequest }
  | { type: "agent-input-status"; event: AgentInputStatusEvent }

type AgentInputTransportContext = {
  chatId: string
  subChatId: string
}

export type LiveAgentInputWithContext = {
  request: AgentInputRequest
  parentChatId: string | null
}

function isAgentInputChunk(chunk: unknown): chunk is AgentInputChunk {
  if (!chunk || typeof chunk !== "object") return false
  const type = (chunk as { type?: unknown }).type
  return type === "agent-input-request" || type === "agent-input-status"
}

export function toPendingAgentInput(
  request: AgentInputRequest,
  context: AgentInputTransportContext,
): PendingUserQuestions {
  return {
    subChatId: context.subChatId,
    parentChatId: context.chatId,
    toolUseId: request.requestId,
    request,
    questions: request.questions.map((question: AgentInputQuestion) => ({
      id: question.id,
      question: question.question,
      header: question.header ?? "Question",
      options: question.options.map((option: AgentInputOption) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? "",
      })),
      multiSelect: question.multiSelect,
      allowCustom: question.allowCustom,
    })),
  }
}

export function reconcileLiveAgentInputs(
  current: Map<string, PendingUserQuestions>,
  entries: readonly LiveAgentInputWithContext[],
): { pending: Map<string, PendingUserQuestions>; changed: boolean } {
  const liveRequestIds = new Set(entries.map(({ request }) => request.requestId))
  const pending = new Map(current)
  let changed = false

  for (const [subChatId, request] of pending) {
    if (request.request && !liveRequestIds.has(request.toolUseId)) {
      pending.delete(subChatId)
      changed = true
    }
  }

  for (const { request, parentChatId } of entries) {
    if (!parentChatId) continue
    if (pending.get(request.chatId)?.toolUseId === request.requestId) continue
    pending.set(
      request.chatId,
      toPendingAgentInput(request, { chatId: parentChatId, subChatId: request.chatId }),
    )
    changed = true
  }

  return { pending, changed }
}

/** Apply provider-neutral input chunks for every harness transport. */
export function handleAgentInputChunk(
  chunk: unknown,
  context: AgentInputTransportContext,
): boolean {
  if (!isAgentInputChunk(chunk)) return false

  if (chunk.type === "agent-input-request") {
    if (chunk.request.chatId !== context.subChatId) return false
    const nextPending = new Map(appStore.get(pendingUserQuestionsAtom))
    nextPending.set(context.subChatId, toPendingAgentInput(chunk.request, context))
    appStore.set(pendingUserQuestionsAtom, nextPending)

    const expired = new Map(appStore.get(expiredUserQuestionsAtom))
    expired.delete(context.subChatId)
    appStore.set(expiredUserQuestionsAtom, expired)
    return true
  }

  if (chunk.event.chatId !== context.subChatId) return false

  const pendingMap = new Map(appStore.get(pendingUserQuestionsAtom))
  const pending = [...pendingMap.values()].find(
    (request) => request.toolUseId === chunk.event.requestId,
  )
  if (!pending) return true

  pendingMap.delete(pending.subChatId)
  appStore.set(pendingUserQuestionsAtom, pendingMap)

  const expiredMap = new Map(appStore.get(expiredUserQuestionsAtom))
  if (chunk.event.status === "expired") expiredMap.set(pending.subChatId, pending)
  else expiredMap.delete(pending.subChatId)
  appStore.set(expiredUserQuestionsAtom, expiredMap)

  if (chunk.event.response || chunk.event.message) {
    const results = new Map(appStore.get(askUserQuestionResultsAtom))
    const questionTextById = new Map(
      pending.questions.map((question) => [question.id, question.question]),
    )
    results.set(
      chunk.event.requestId,
      chunk.event.response
        ? {
            answers: Object.fromEntries(
              Object.entries(chunk.event.response.answers).map(([questionId, values]) => [
                questionTextById.get(questionId) ?? questionId,
                values.join(", "),
              ]),
            ),
          }
        : chunk.event.message,
    )
    appStore.set(askUserQuestionResultsAtom, results)
  }

  return true
}
