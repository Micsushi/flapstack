import { create } from "zustand"
import { persist, subscribeWithSelector } from "zustand/middleware"
import type { AgentQueueItem } from "../lib/queue-utils"
import { removeQueueItem } from "../lib/queue-utils"
import { getWindowId } from "../../../contexts/WindowContext"

// Empty array constant to avoid creating new arrays on each call
// Exported for use in selectors to maintain stable reference
export const EMPTY_QUEUE: AgentQueueItem[] = []

interface MessageQueueState {
  // Map: subChatId -> queue items
  queues: Record<string, AgentQueueItem[]>

  // Queues held after a manual stop. They resume only after an explicit send.
  heldQueues: Record<string, number>
  nextHoldId: number
  processingQueues: Record<string, boolean>

  // Actions
  addToQueue: (subChatId: string, item: AgentQueueItem) => void
  removeFromQueue: (subChatId: string, itemId: string) => void
  reorderItem: (subChatId: string, itemId: string, targetItemId: string) => void
  getQueue: (subChatId: string) => AgentQueueItem[]
  getNextItem: (subChatId: string) => AgentQueueItem | null
  clearQueue: (subChatId: string) => void
  holdQueue: (subChatId: string) => void
  getQueueHold: (subChatId: string) => number
  resumeQueue: (subChatId: string, holdId: number) => void
  canAutoProcessQueue: (subChatId: string) => boolean
  tryAcquireProcessing: (subChatId: string) => boolean
  releaseProcessing: (subChatId: string) => void
  // Returns and removes the item from queue (atomic operation)
  popItem: (subChatId: string, itemId: string) => AgentQueueItem | null
  // Add item to front of queue (for error recovery)
  prependItem: (subChatId: string, item: AgentQueueItem) => void
}

export const useMessageQueueStore = create<MessageQueueState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        queues: {},
        heldQueues: {},
        nextHoldId: 0,
        processingQueues: {},

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
            const nextQueue = removeQueueItem(currentQueue, itemId)
            return {
              queues: {
                ...state.queues,
                [subChatId]: nextQueue,
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
          const now = Date.now()
          return (
            queue.find(
              (item) => item.status === "pending" && (!item.nextRetryAt || item.nextRetryAt <= now),
            ) || null
          )
        },

        clearQueue: (subChatId) => {
          set((state) => {
            const heldQueues = { ...state.heldQueues }
            delete heldQueues[subChatId]
            return {
              queues: { ...state.queues, [subChatId]: [] },
              heldQueues,
            }
          })
        },

        holdQueue: (subChatId) => {
          set((state) => {
            const holdId = state.nextHoldId + 1
            return {
              heldQueues: { ...state.heldQueues, [subChatId]: holdId },
              nextHoldId: holdId,
            }
          })
        },

        getQueueHold: (subChatId) => {
          return get().heldQueues[subChatId] ?? 0
        },

        resumeQueue: (subChatId, holdId) => {
          set((state) => {
            if (state.heldQueues[subChatId] !== holdId) return state
            const heldQueues = { ...state.heldQueues }
            delete heldQueues[subChatId]
            return { heldQueues }
          })
        },

        canAutoProcessQueue: (subChatId) => {
          const state = get()
          return (
            Boolean(state.queues[subChatId]?.some((item) => item.status === "pending")) &&
            !state.heldQueues[subChatId] &&
            !state.processingQueues[subChatId]
          )
        },

        tryAcquireProcessing: (subChatId) => {
          let acquired = false
          set((state) => {
            if (state.processingQueues[subChatId]) return state
            acquired = true
            return {
              processingQueues: { ...state.processingQueues, [subChatId]: true },
            }
          })
          return acquired
        },

        releaseProcessing: (subChatId) => {
          set((state) => {
            if (!state.processingQueues[subChatId]) return state
            const processingQueues = { ...state.processingQueues }
            delete processingQueues[subChatId]
            return { processingQueues }
          })
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
      }),
      {
        name: `${typeof window === "undefined" ? "test" : getWindowId()}:message-queue-store`,
        partialize: (state) => ({
          queues: state.queues,
          heldQueues: state.heldQueues,
          nextHoldId: state.nextHoldId,
        }),
        merge: (persisted, current) => {
          const saved = persisted as Partial<MessageQueueState>
          const queues = Object.fromEntries(
            Object.entries(saved.queues ?? {}).map(([subChatId, items]) => [
              subChatId,
              items.map((item) => ({ ...item, timestamp: new Date(item.timestamp) })),
            ]),
          )
          return { ...current, ...saved, queues, processingQueues: {} }
        },
      },
    ),
  ),
)
