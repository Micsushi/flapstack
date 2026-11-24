import type { McpCallerIdentity } from "../mcp-control/types"

export type DesktopSpeechCommand =
  | {
      kind: "speak"
      chatId: string
      subChatId: string
      messageId: string
      text: string
      rate: number
    }
  | { kind: "stop"; requestedOnly?: boolean }

type Receiver = (command: DesktopSpeechCommand) => void
const receivers = new Map<number, Receiver>()
let lastRequest: { windowId: number; caller: string } | undefined

export function registerDesktopSpeechReceiver(windowId: number, receive: Receiver) {
  receivers.set(windowId, receive)
  return () => {
    if (receivers.get(windowId) !== receive) return
    receivers.delete(windowId)
    if (lastRequest?.windowId === windowId) lastRequest = undefined
  }
}

export function requestDesktopSpeech(caller: McpCallerIdentity, command: DesktopSpeechCommand) {
  if (!receivers.size) throw new Error("No Flapstack playback window is connected.")
  if (command.kind === "stop" && !caller.projectId && !caller.taskId) {
    for (const receive of receivers.values()) receive(command)
    lastRequest = undefined
    return { playback: "stop-requested" }
  }
  if (command.kind === "stop" && lastRequest?.caller !== caller.chatId) {
    return { playback: "no-active-request" }
  }
  const windowId = lastRequest?.windowId ?? receivers.keys().next().value
  const receive = windowId !== undefined && receivers.get(windowId)
  if (!receive || windowId === undefined) throw new Error("Playback window disconnected.")
  receive(command.kind === "stop" ? { kind: "stop", requestedOnly: true } : command)
  lastRequest = command.kind === "stop" ? undefined : { windowId, caller: caller.chatId }
  return { playback: command.kind === "stop" ? "stop-requested" : "requested" }
}
