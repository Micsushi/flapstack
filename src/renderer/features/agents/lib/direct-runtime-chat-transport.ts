import { toast } from "sonner"
import { getQueryKey } from "@trpc/react-query"
import type { ChatMode } from "../../../../shared/chat-mode"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import { trpc, trpcClient } from "../../../lib/trpc"
import { RuntimeActivityChatChunkMapper } from "./runtime-activity-chat-chunks"
import { directRuntimeFinishMetadata } from "./runtime-finish-metadata"
import { RuntimeResponseLabelFilter, RuntimeTextChatChunkMapper } from "./runtime-text-chat-chunks"

type DirectRuntimeHarness = "codex" | "claude-code"
type RuntimeEffort = "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"

export async function createDirectRuntimeStream(input: {
  chatId: string
  subChatId: string
  harness: DirectRuntimeHarness
  prompt: string
  promptMessageId?: string
  model: string | null
  mode: ChatMode
  reasoningEffort: RuntimeEffort | null
  reasoningEnabled: boolean
  images: Array<{ base64Data: string; mediaType: string; filename?: string }>
  hotlineEnabled: boolean
  abortSignal?: AbortSignal
}): Promise<ReadableStream<any> | null> {
  const resolution = await trpcClient.agentRuntimeChat.prepare.mutate({
    chatId: input.chatId,
    subChatId: input.subChatId,
    harness: input.harness,
    model: input.model,
    mode: input.mode,
    reasoningEffort: input.reasoningEffort,
    reasoningEnabled: input.reasoningEnabled,
  })
  refreshPinnedRuntimeSelection(input.chatId)
  if (!resolution.direct) return null

  const runId = crypto.randomUUID()
  let cancelStream: (() => void) | null = null
  return new ReadableStream({
    start(controller) {
      let closed = false
      const activityMapper = new RuntimeActivityChatChunkMapper(runId)
      const textMapper = new RuntimeTextChatChunkMapper(
        runId,
        new RuntimeResponseLabelFilter(!input.hotlineEnabled),
      )
      let startedAtMs = Date.now()
      let subscription: { unsubscribe(): void } | null = null
      const close = () => {
        if (closed) return
        closed = true
        input.abortSignal?.removeEventListener("abort", abort)
        try {
          controller.close()
        } catch {
          // Stream already closed.
        }
      }
      function abort() {
        void trpcClient.agentRuntimeChat.cancel.mutate({ runId }).catch(() => undefined)
        subscription?.unsubscribe()
        close()
      }
      cancelStream = abort
      if (input.abortSignal?.aborted) {
        abort()
        return
      }
      input.abortSignal?.addEventListener("abort", abort, { once: true })

      subscription = trpcClient.agentRuntimeChat.launch.subscribe(
        {
          runId,
          chatId: input.chatId,
          subChatId: input.subChatId,
          harness: input.harness,
          prompt: input.prompt,
          ...(input.images.length > 0 ? { images: input.images } : {}),
          ...(input.promptMessageId ? { promptMessageId: input.promptMessageId } : {}),
          model: input.model,
          mode: input.mode,
          reasoningEffort: input.reasoningEffort,
          reasoningEnabled: input.reasoningEnabled,
        },
        {
          onData(event) {
            if (closed) return
            if (event.type === "started") {
              startedAtMs = Date.now()
            } else if (event.type === "assistant-text") {
              for (const chunk of activityMapper.beforeText()) controller.enqueue(chunk)
              for (const chunk of textMapper.map(event)) controller.enqueue(chunk)
            } else if (event.type === "activity-batch") {
              const activityChunks = activityMapper.map(event.events)
              if (activityChunks.length > 0) {
                for (const chunk of textMapper.beforeActivity()) controller.enqueue(chunk)
                for (const chunk of activityChunks) controller.enqueue(chunk)
              }
            } else if (event.type === "finished") {
              for (const chunk of textMapper.finish()) controller.enqueue(chunk)
              for (const chunk of activityMapper.finish()) controller.enqueue(chunk)
              controller.enqueue({
                type: "message-metadata",
                messageMetadata: directRuntimeFinishMetadata({
                  runId,
                  harness: input.harness,
                  startedAtMs,
                  durationMs: event.durationMs,
                }),
              })
              controller.enqueue({ type: "finish" })
              close()
            }
          },
          onError(error) {
            if (closed) return
            closed = true
            input.abortSignal?.removeEventListener("abort", abort)
            subscription?.unsubscribe()
            toast.error(`${runtimeLabel(input.harness)} Runtime failed`, {
              description: error.message,
            })
            controller.error(error)
          },
          onComplete: close,
        },
      )
    },
    cancel() {
      cancelStream?.()
    },
  })
}

function refreshPinnedRuntimeSelection(chatId: string): void {
  const queryClient = getQueryClient()
  if (!queryClient) return
  void queryClient.invalidateQueries({
    queryKey: getQueryKey(trpc.chats.get, { id: chatId }, "query"),
    exact: true,
  })
}

export function splitCodexRuntimeModel(selection: string): {
  model: string
  effort: RuntimeEffort | null
} {
  const match = selection.trim().match(/^(.*)\/(minimal|none|low|medium|high|xhigh|max|ultra)$/i)
  if (!match) return { model: selection.trim(), effort: null }
  return { model: match[1], effort: match[2].toLowerCase() as RuntimeEffort }
}

function runtimeLabel(harness: DirectRuntimeHarness): string {
  return harness === "codex" ? "Codex" : "Claude Code"
}
