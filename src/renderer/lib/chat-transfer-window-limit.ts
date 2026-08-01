import { createElement } from "react"
import { toast } from "sonner"
import type {
  ChatTransferResult,
  ChatTransferStart,
  ChatTransferStartResult,
  ChatTransferWindowDestination,
} from "../../shared/chat-window-transfer"

export type ChatTransferDestinationAction =
  "split-left" | "split-right" | "split-top" | "split-bottom" | "add-as-tab" | "focus" | "cancel"

type ChatTransferChooserContext = Omit<ChatTransferStart, "version">

type ChatTransferChooserApi = {
  startChatTransfer: (
    input: ChatTransferStart,
  ) => Promise<ChatTransferStartResult | ChatTransferResult>
  reserveChatTransfer: (input: {
    version: 1
    nonce: string
    destinationWindowId: string
    destinationGroupId: string
    zone: "tab" | "left" | "right" | "top" | "bottom"
  }) => Promise<ChatTransferResult>
  focusStableWindow: (stableId: string) => Promise<"focused" | "recovering" | "missing">
}

export async function executeChatTransferDestinationAction(
  api: ChatTransferChooserApi,
  context: ChatTransferChooserContext,
  destination: Pick<ChatTransferWindowDestination, "stableId" | "label"> & {
    groupId?: string
  },
  action: ChatTransferDestinationAction,
): Promise<ChatTransferResult | { status: "focused" | "cancelled" | "recovering" | "missing" }> {
  if (action === "cancel") return { status: "cancelled" }
  if (action === "focus") {
    return { status: await api.focusStableWindow(destination.stableId) }
  }
  const started = await api.startChatTransfer({ version: 1, ...context })
  if (started.status !== "started") return started
  return api.reserveChatTransfer({
    version: 1,
    nonce: started.transfer.nonce,
    destinationWindowId: destination.stableId,
    destinationGroupId: destination.groupId ?? "chat-group-1",
    zone: destinationZone(action),
  })
}

export function showChatTransferWindowLimitChoice(input: {
  api: ChatTransferChooserApi
  context: ChatTransferChooserContext
  destinations: readonly ChatTransferWindowDestination[]
}): void {
  showChatTransferWindowChoice({
    ...input,
    title: "Four-window limit reached",
  })
}

export function showChatTransferWindowChoice(input: {
  api: ChatTransferChooserApi
  context: ChatTransferChooserContext
  destinations: readonly ChatTransferWindowDestination[]
  title?: string
}): void {
  toast.custom(
    (toastId) =>
      createElement(
        "section",
        {
          "aria-label": "Choose an existing window for this Chat",
          className:
            "w-[420px] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg",
          role: "dialog",
        },
        createElement(
          "h2",
          { className: "text-sm font-semibold" },
          input.title ?? "Move Chat to an existing window",
        ),
        createElement(
          "p",
          { className: "mt-1 text-xs text-muted-foreground" },
          "The Chat and editable ownership stay here until an existing destination commits.",
        ),
        ...input.destinations.map((destination) =>
          createElement(
            "div",
            {
              className: "mt-3 rounded-md border border-border p-2",
              key: destination.stableId,
            },
            createElement("p", { className: "text-xs font-medium" }, destination.label),
            createElement(
              "div",
              { className: "mt-2 flex flex-wrap gap-2" },
              ...destination.actions.flatMap((action) => {
                const groups = isPlacementAction(action)
                  ? (destination.groups ?? [{ id: "chat-group-1", label: "Active group" }])
                  : [{ id: "", label: "" }]
                return groups.map((group) =>
                  createElement(
                    "button",
                    {
                      className:
                        "rounded-md border border-border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60",
                      key: `${action}:${group.id}`,
                      type: "button",
                      onClick: async () => {
                        if (action === "cancel") {
                          toast.dismiss(toastId)
                          return
                        }
                        const result = await executeChatTransferDestinationAction(
                          input.api,
                          input.context,
                          { ...destination, groupId: group.id || undefined },
                          action,
                        )
                        if (
                          result.status === "reserved" ||
                          result.status === "focused" ||
                          result.status === "recovering"
                        ) {
                          toast.dismiss(toastId)
                        } else {
                          toast.error("Chat transfer was not started", {
                            description: "The Chat and editable ownership remain in this window.",
                          })
                        }
                      },
                    },
                    actionLabel(
                      action,
                      group.label ? `${destination.label} · ${group.label}` : destination.label,
                    ),
                  ),
                )
              }),
            ),
          ),
        ),
      ),
    { duration: Infinity },
  )
}

function actionLabel(action: ChatTransferDestinationAction, label: string): string {
  if (action === "add-as-tab") return `Add as tab in ${label}`
  if (action === "split-left") return `Split left in ${label}`
  if (action === "split-right") return `Split right in ${label}`
  if (action === "split-top") return `Split above in ${label}`
  if (action === "split-bottom") return `Split below in ${label}`
  if (action === "focus") return `Focus ${label}`
  return "Cancel"
}

function isPlacementAction(action: ChatTransferDestinationAction): boolean {
  return action !== "focus" && action !== "cancel"
}

function destinationZone(
  action: Exclude<ChatTransferDestinationAction, "focus" | "cancel">,
): "tab" | "left" | "right" | "top" | "bottom" {
  if (action === "add-as-tab") return "tab"
  if (action === "split-left") return "left"
  if (action === "split-right") return "right"
  if (action === "split-top") return "top"
  return "bottom"
}
