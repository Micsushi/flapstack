import type { ChatWorkbenchLayout } from "./chat-workbench"
import type { ChatWorkbenchNavigation } from "./chat-workbench-navigation"

export type ChatWorkbenchSnapshot = {
  navigation: ChatWorkbenchNavigation
  layout: ChatWorkbenchLayout
  openChatIds: string[]
}

export type ChatWorkbenchHistory = {
  past: ChatWorkbenchSnapshot[]
  future: ChatWorkbenchSnapshot[]
}

const HISTORY_LIMIT = 50

export function createChatWorkbenchHistory(): ChatWorkbenchHistory {
  return { past: [], future: [] }
}

export function recordChatWorkbenchHistory(
  history: ChatWorkbenchHistory,
  snapshot: ChatWorkbenchSnapshot,
): ChatWorkbenchHistory {
  return {
    past: [...history.past, snapshot].slice(-HISTORY_LIMIT),
    future: [],
  }
}

export function undoChatWorkbenchHistory(
  history: ChatWorkbenchHistory,
  current: ChatWorkbenchSnapshot,
): { history: ChatWorkbenchHistory; snapshot: ChatWorkbenchSnapshot } | null {
  const snapshot = history.past.at(-1)
  if (!snapshot) return null
  return {
    snapshot,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, HISTORY_LIMIT),
    },
  }
}

export function redoChatWorkbenchHistory(
  history: ChatWorkbenchHistory,
  current: ChatWorkbenchSnapshot,
): { history: ChatWorkbenchHistory; snapshot: ChatWorkbenchSnapshot } | null {
  const snapshot = history.future[0]
  if (!snapshot) return null
  return {
    snapshot,
    history: {
      past: [...history.past, current].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    },
  }
}
