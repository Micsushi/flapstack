import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import type { AgentQueueItem } from "../lib/queue-utils"
import { removeQueueItem } from "../lib/queue-utils"

// Empty array constant to avoid creating new arrays on each call
// Exported for use in selectors to maintain stable reference
export const EMPTY_QUEUE: AgentQueueItem[] = []

interface MessageQueueState {
  // Map: subChatId -> queue items
  queues: Record<string, AgentQueueItem[]>

  // Map: subChatId -> counter incremented each time QueueProcessor auto-sends a message.
  // Used by active-chat to trigger scroll-to-bottom when a queued message is sent.
  queueSentTriggers: Record<string, number>

  // Actions
  addToQueue: (subChatId: string, item: AgentQueueItem) => void
  removeFromQueue: (subChatId: string, itemId: string) => void
  reorderItem: (subChatId: string, itemId: string, targetItemId: string) => void
  getQueue: (subChatId: string) => AgentQueueItem[]
  getNextItem: (subChatId: string) => AgentQueueItem | null
  clearQueue: (subChatId: string) => void
  // Returns and removes the item from queue (atomic operation)
  popItem: (subChatId: string, itemId: string) => AgentQueueItem | null
  // Add item to front of queue (for error recovery)
  prependItem: (subChatId: string, item: AgentQueueItem) => void
  // Signal that a queued message was auto-sent (for scroll triggering)
  triggerQueueSent: (subChatId: string) => void
}

export const useMessageQueueStore = create<MessageQueueState>()(
  subscribeWithSelector((set, get) => ({
    queues: {},
    queueSentTriggers: {},

    addToQueue: (subChatId, item) => {
      set((state) => ({
        queues: {
          ...state.queues,
          [subChatId]: [...(state.queues[subChatId] || []), item],
        },
      }))
    },

    removeFromQueue: (subChatId, itemId) => {
      set((state) => {
        const currentQueue = state.queues[subChatId] || []
        return {
          queues: {
            ...state.queues,
            [subChatId]: removeQueueItem(currentQueue, itemId),
          },
        }
      })
    },

    reorderItem: (subChatId, itemId, targetItemId) => {
      if (itemId === targetItemId) return
      set((state) => {
        const currentQueue = state.queues[subChatId] || []
        const fromIndex = currentQueue.findIndex((item) => item.id === itemId)
        const targetIndex = currentQueue.findIndex((item) => item.id === targetItemId)
        if (fromIndex === -1 || targetIndex === -1) return state

        const nextQueue = [...currentQueue]
        const [movedItem] = nextQueue.splice(fromIndex, 1)
        if (!movedItem) return state
        nextQueue.splice(targetIndex, 0, movedItem)
        return { queues: { ...state.queues, [subChatId]: nextQueue } }
      })
    },

    getQueue: (subChatId) => {
      return get().queues[subChatId] ?? EMPTY_QUEUE
    },

    getNextItem: (subChatId) => {
      const queue = get().queues[subChatId] || []
      return queue.find((item) => item.status === "pending") || null
    },

    clearQueue: (subChatId) => {
      set((state) => ({
        queues: {
          ...state.queues,
          [subChatId]: [],
        },
      }))
    },

    // Atomic pop: find and remove in single set() call to prevent race conditions
    popItem: (subChatId, itemId) => {
      let foundItem: AgentQueueItem | null = null
      set((state) => {
        const currentQueue = state.queues[subChatId] || []
        foundItem = currentQueue.find((i) => i.id === itemId) || null
        if (!foundItem) return state
        return {
          queues: {
            ...state.queues,
            [subChatId]: currentQueue.filter((i) => i.id !== itemId),
          },
        }
      })
      return foundItem
    },

    // Add item to front of queue (used for error recovery - requeue failed items)
    prependItem: (subChatId, item) => {
      set((state) => ({
        queues: {
          ...state.queues,
          [subChatId]: [item, ...(state.queues[subChatId] || [])],
        },
      }))
    },

    triggerQueueSent: (subChatId) => {
      set((state) => ({
        queueSentTriggers: {
          ...state.queueSentTriggers,
          [subChatId]: (state.queueSentTriggers[subChatId] || 0) + 1,
        },
      }))
    },
  })),
)
