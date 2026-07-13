import type { ChatTransport, UIMessage } from "ai"
import { getDefaultStore } from "jotai"
import { createElement } from "react"
import { toast } from "sonner"
import { agentsSettingsDialogActiveTabAtom, agentsSettingsDialogOpenAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import { DEFAULT_CURSOR_MODEL_ID } from "../../../../shared/model-catalog"
import {
  pendingAuthRetryMessageAtom,
  subChatCursorModelIdAtomFamily,
  subChatReasoningEnabledAtomFamily,
} from "../atoms"
import { showProviderErrorToast } from "./error-toast"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import { handleAgentInputChunk } from "./agent-input-transport"

/**
 * Client transport for the Cursor (`cursor-agent`) harness - Stage 2 Track D.
 *
 * Mirrors {@link ACPChatTransport}: it subscribes to the server-side
 * `cursor.chat` observable (which spawns cursor-agent and streams stream-json
 * translated into UIMessageChunks) and pipes chunks into a ReadableStream that
 * the AI SDK `useChat` loop consumes. Persistence happens server-side, so this
 * transport only forwards chunks, surfaces auth/errors, and handles cancel.
 *
 * NOTE (D5 wiring): to make Cursor selectable end-to-end, `active-chat.tsx`
 * must branch to this transport when the chat provider is `cursor-agent`
 * (alongside the existing `codex` / `claude-code` branches) and the harness
 * selector must offer Cursor. Those selector/default decisions are the deferred
 * integration step documented in the vault STAGE2-TRACK.md (agentsvault Wiki/Projects/flapstack).
 */

type UIMessageChunk = any

type CursorChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
}

type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

// After an auth-error, force a fresh cursor-agent session on the next send.
const forceFreshSessionSubChats = new Set<string>()

function openCursorSettings() {
  const store = getDefaultStore()
  store.set(agentsSettingsDialogActiveTabAtom, "usage")
  store.set(agentsSettingsDialogOpenAtom, true)
}

async function waitForCursorConnection(subChatId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const integration = await trpcClient.cursor.getIntegration.query().catch(() => null)
    if (integration?.isConnected) {
      const pending = appStore.get(pendingAuthRetryMessageAtom)
      if (pending?.provider === "cursor-agent" && pending.subChatId === subChatId) {
        appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
        toast.success("Cursor connected. Retrying your message.")
      }
      return
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000))
  }
  toast.error("Cursor login was not detected. Check the connection and retry.")
}

function showCursorAuthToast(subChatId: string) {
  toast.custom(
    (toastId) =>
      createElement(
        "div",
        { className: "w-[380px] rounded-lg border bg-background p-4 shadow-lg" },
        createElement("div", { className: "font-medium" }, "Cursor sign-in required"),
        createElement(
          "div",
          { className: "mt-1 text-sm text-muted-foreground" },
          "Connect Cursor in your browser or configure a Cursor API key, then retry.",
        ),
        createElement(
          "div",
          { className: "mt-3 flex flex-wrap gap-2" },
          createElement(
            "button",
            {
              className: "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground",
              onClick: () => {
                toast.dismiss(toastId)
                void trpcClient.cursor.startLogin.mutate().then(
                  () => waitForCursorConnection(subChatId),
                  (error: unknown) => {
                    toast.error("Could not start Cursor login", {
                      description: error instanceof Error ? error.message : String(error),
                    })
                  },
                )
              },
            },
            "Connect Cursor",
          ),
          createElement(
            "button",
            {
              className: "rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
              onClick: () => {
                toast.dismiss(toastId)
                openCursorSettings()
              },
            },
            "Open settings",
          ),
        ),
      ),
    { duration: Infinity },
  )
}

function getSelectedCursorModel(subChatId: string): string {
  return appStore.get(subChatCursorModelIdAtomFamily(subChatId)) || DEFAULT_CURSOR_MODEL_ID
}

export class CursorChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: CursorChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")
    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)

    // cursor-agent's verified headless CLI has no image-input surface. Reject
    // before persisting/sending a prompt so an attachment is never shown as if
    // Cursor had received it.
    if (images.length > 0) {
      toast.error("Cursor does not support image attachments yet")
      throw new Error("Cursor does not support image attachments yet")
    }

    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    const forceNewSession = forceFreshSessionSubChats.has(this.config.subChatId)
    if (forceNewSession) forceFreshSessionSubChats.delete(this.config.subChatId)

    const model = getSelectedCursorModel(this.config.subChatId)
    const reasoningEnabled = appStore.get(subChatReasoningEnabledAtomFamily(this.config.subChatId))

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          sub?.unsubscribe()
        }

        sub = trpcClient.cursor.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
            model,
            reasoningEnabled,
            ...(sessionId ? { sessionId } : {}),
            ...(forceNewSession ? { forceNewSession: true } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              handleAgentInputChunk(chunk, {
                chatId: this.config.chatId,
                subChatId: this.config.subChatId,
              })
              if (!reasoningEnabled && String(chunk.type).startsWith("reasoning-")) return
              if (chunk.type === "auth-error") {
                forceFreshSessionSubChats.add(this.config.subChatId)
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  provider: "cursor-agent",
                  prompt,
                  readyToRetry: false,
                })
                showCursorAuthToast(this.config.subChatId)
                void trpcClient.cursor.cleanup
                  .mutate({ subChatId: this.config.subChatId })
                  .catch(() => {})
                controller.error(new Error("Cursor authentication required"))
                return
              }

              if (chunk.type === "error") {
                showProviderErrorToast(
                  "Cursor error",
                  chunk.errorText || "An unexpected cursor-agent error occurred.",
                  { chatId: this.config.chatId, subChatId: this.config.subChatId },
                )
              }

              try {
                controller.enqueue(chunk)
              } catch {
                // Stream already closed.
              }

              if (chunk.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // Already closed.
                }
              }
            },
            onError: (error: Error) => {
              showProviderErrorToast("Cursor request failed", error.message, {
                chatId: this.config.chatId,
                subChatId: this.config.subChatId,
              })
              controller.error(error)
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Already closed.
              }
              safeUnsubscribe()
            },
          },
        )

        options.abortSignal?.addEventListener("abort", () => {
          void trpcClient.cursor.cancel
            .mutate({ subChatId: this.config.subChatId, runId })
            .catch(() => {})
          try {
            controller.close()
          } catch {
            // Already closed.
          }
          safeUnsubscribe()
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.cursor.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {})
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message?.parts) return ""
    const textParts: string[] = []
    const fileContents: string[] = []
    for (const part of message.parts) {
      if (part.type === "text" && (part as any).text) {
        textParts.push((part as any).text)
      } else if ((part as any).type === "file-content") {
        const filePart = part as any
        const fileName = filePart.filePath?.split("/").pop() || filePart.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${filePart.content}`)
      }
    }
    return textParts.join("\n") + fileContents.join("")
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message?.parts) return []
    const images: ImageAttachment[] = []
    for (const part of message.parts) {
      if (part.type === "data-image" && (part as any).data) {
        const data = (part as any).data
        if (data.base64Data && data.mediaType) {
          images.push({
            base64Data: data.base64Data,
            mediaType: data.mediaType,
            filename: data.filename,
          })
        }
      }
    }
    return images
  }
}
