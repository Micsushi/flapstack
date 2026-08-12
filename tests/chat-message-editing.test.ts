import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"
import {
  buildQueuedMessageParts,
  createQueueItem,
  queueItemAfterFailure,
} from "../src/renderer/features/agents/lib/queue-utils"
import { useMessageQueueStore } from "../src/renderer/features/agents/stores/message-queue-store"

const messageGroupSource = readFileSync(
  "src/renderer/features/agents/main/isolated-message-group.tsx",
  "utf8",
)
const queueSource = readFileSync(
  "src/renderer/features/agents/ui/agent-queue-indicator.tsx",
  "utf8",
)
const chatsRouterSource = readFileSync("src/main/lib/trpc/routers/chats.ts", "utf8")
const assistantMessageSource = readFileSync(
  "src/renderer/features/agents/main/assistant-message-item.tsx",
  "utf8",
)
const activeChatSource = readFileSync("src/renderer/features/agents/main/active-chat.tsx", "utf8")
const queueProcessorSource = readFileSync(
  "src/renderer/features/agents/components/queue-processor.tsx",
  "utf8",
)

describe("stopped reasoning disclosure", () => {
  it("keeps the stop row visible and only exposes expansion when details exist", () => {
    expect(assistantMessageSource).toContain("|| wasStopped")
    expect(assistantMessageSource).toContain("hasDetails={hasActivity && visibleStepsCount > 0}")
    expect(assistantMessageSource).toContain("hasDetails && isExpanded")
  })
})

describe("latest message editing", () => {
  it("offers editing only on the latest non-streaming user message", () => {
    expect(messageGroupSource).toContain("onEditLatest && isLastGroup && !isStreaming")
    expect(messageGroupSource).toContain("Edit message")
  })

  it("only moves inline user-message actions into overflow at narrow widths", () => {
    expect(messageGroupSource).toContain("renderUserMessageOptionsMenu(true)")
    expect(messageGroupSource).toContain("renderUserMessageOptionsMenu(false)")
    expect(messageGroupSource).toContain('<span className="inline-flex @[420px]:hidden">')
    expect(messageGroupSource).toContain('<span className="hidden @[420px]:inline-flex">')
    expect(messageGroupSource).not.toContain("px-1 pb-1 @[420px]:hidden")
  })

  it("rewinds the turn and restores files only when a checkpoint exists", () => {
    expect(chatsRouterSource).toContain("editLatestUserMessage")
    expect(chatsRouterSource).toContain("await restoreCheckpoint(run.beforeCheckpointId)")
    expect(chatsRouterSource).not.toContain("This older message has no safe pre-run checkpoint")
    expect(chatsRouterSource).toContain("messages.slice(0, userIndex)")
  })

  it("shows the server reason if editing still fails", () => {
    expect(activeChatSource).toContain('toast.error("Failed to edit message", {')
    expect(activeChatSource).toContain("description: editErrorMessage")
  })
})

describe("queued message editing and ordering", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({
      queues: {},
      heldQueues: {},
      nextHoldId: 0,
      processingQueues: {},
    })
  })

  it("exposes a left drag handle and an edit action", () => {
    expect(queueSource).toContain('aria-label="Drag to reorder queued message"')
    expect(queueSource).toContain('aria-label="Edit queued message"')
  })

  it("reorders queued messages without changing their contents", () => {
    const first = createQueueItem("first", "First")
    const second = createQueueItem("second", "Second")
    const third = createQueueItem("third", "Third")
    const store = useMessageQueueStore.getState()
    store.addToQueue("chat", first)
    store.addToQueue("chat", second)
    store.addToQueue("chat", third)

    useMessageQueueStore.getState().reorderItem("chat", "third", "first")

    expect(useMessageQueueStore.getState().getQueue("chat")).toEqual([third, first, second])
  })

  it("atomically removes a queued message for composer editing", () => {
    const item = createQueueItem("edit-me", "Revise this")
    useMessageQueueStore.getState().addToQueue("chat", item)

    expect(useMessageQueueStore.getState().popItem("chat", item.id)).toEqual(item)
    expect(useMessageQueueStore.getState().getQueue("chat")).toEqual([])
  })

  it("holds queued follow-ups after a manual stop until an explicit send resumes them", () => {
    const item = createQueueItem("follow-up", "Continue after steering")
    useMessageQueueStore.getState().addToQueue("chat", item)

    useMessageQueueStore.getState().holdQueue("chat")
    const holdId = useMessageQueueStore.getState().getQueueHold("chat")

    expect(holdId).toBeGreaterThan(0)
    expect(useMessageQueueStore.getState().getQueue("chat")).toEqual([item])
    expect(useMessageQueueStore.getState().canAutoProcessQueue("chat")).toBe(false)

    useMessageQueueStore.getState().resumeQueue("chat", holdId)
    expect(useMessageQueueStore.getState().heldQueues.chat).toBeUndefined()
    expect(useMessageQueueStore.getState().canAutoProcessQueue("chat")).toBe(true)
  })

  it("wires manual stop and explicit sends into the global queue gate", () => {
    expect(activeChatSource).toContain("holdQueue(subChatId)")
    expect(activeChatSource).toContain("resumeQueue(subChatId, queueHold)")
    expect(queueProcessorSource.match(/canAutoProcessQueue\(subChatId\)/g)?.length).toBeGreaterThan(
      1,
    )
  })

  it("does not let a completed steer release a newer manual pause", () => {
    useMessageQueueStore.getState().addToQueue("chat", createQueueItem("follow-up", "Wait for me"))
    useMessageQueueStore.getState().holdQueue("chat")
    const steerHold = useMessageQueueStore.getState().getQueueHold("chat")
    useMessageQueueStore.getState().holdQueue("chat")

    useMessageQueueStore.getState().resumeQueue("chat", steerHold)

    expect(useMessageQueueStore.getState().canAutoProcessQueue("chat")).toBe(false)
  })

  it("keeps a manual hold when the user removes the final queued message", () => {
    const item = createQueueItem("remove-me", "Never mind")
    useMessageQueueStore.getState().addToQueue("chat", item)
    useMessageQueueStore.getState().holdQueue("chat")

    useMessageQueueStore.getState().removeFromQueue("chat", item.id)

    expect(useMessageQueueStore.getState().getQueueHold("chat")).toBeGreaterThan(0)
  })

  it("can hold an empty queue before a follow-up is added", () => {
    useMessageQueueStore.getState().holdQueue("chat")
    useMessageQueueStore
      .getState()
      .addToQueue("chat", createQueueItem("later", "Wait until I steer"))

    expect(useMessageQueueStore.getState().canAutoProcessQueue("chat")).toBe(false)
  })

  it("serializes queued chat history with its distinct mention prefix", () => {
    const item = createQueueItem(
      "history",
      "Review this",
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          id: "history-1",
          filePath: "C:/tmp/history.txt",
          filename: "history.txt",
          size: 42,
          preview: "Earlier chat",
          kind: "chatHistory",
        },
      ],
    )
    expect(buildQueuedMessageParts(item).at(-1)?.text).toContain("chatHistory:")
  })

  it("serializes send ownership across manual and background queue paths", () => {
    const store = useMessageQueueStore.getState()
    expect(store.tryAcquireProcessing("chat")).toBe(true)
    expect(useMessageQueueStore.getState().tryAcquireProcessing("chat")).toBe(false)
    useMessageQueueStore.getState().releaseProcessing("chat")
    expect(useMessageQueueStore.getState().tryAcquireProcessing("chat")).toBe(true)
  })

  it("parks a permanently failing queued message after bounded retries", () => {
    let item = createQueueItem("retry", "Try me")
    item = queueItemAfterFailure(item, new Error("offline"))
    item = queueItemAfterFailure(item, new Error("offline"))
    item = queueItemAfterFailure(item, new Error("offline"))
    expect(item).toMatchObject({ status: "failed", attempts: 3, lastError: "offline" })
    expect(item.nextRetryAt).toBeUndefined()
  })
})
