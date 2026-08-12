"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useMessageQueueStore } from "../stores/message-queue-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { getAgentSubChatStore } from "../stores/sub-chat-store"
import { agentChatStore } from "../stores/agent-chat-store"
import { trackMessageSent } from "../../../lib/analytics"
import { appStore } from "../../../lib/jotai-store"
import { loadingSubChatsAtom, setLoading, clearLoading } from "../atoms"
import {
  buildQueuedMessageParts,
  MAX_QUEUE_SEND_ATTEMPTS,
  queueItemAfterFailure,
} from "../lib/queue-utils"
import { trpcClient } from "../../../lib/trpc"

// Delay between processing queue items (ms)
const QUEUE_PROCESS_DELAY = 1000

/**
 * Global queue processor component.
 *
 * This component runs at the app level (AgentsLayout) and processes
 * message queues for ALL sub-chats, regardless of which one is currently active.
 *
 * Key insight: Unlike the previous local useEffect in ChatViewInner which only
 * processed the currently active sub-chat's queue, this component listens to
 * ALL queues and streaming statuses globally.
 */
export function QueueProcessor() {
  // Track timers for cleanup
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const checkoutBlockedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Function to process queue for a specific sub-chat
    const processQueue = async (subChatId: string) => {
      // Check streaming status
      const status = useStreamingStatusStore.getState().getStatus(subChatId)
      if (status !== "ready") {
        return
      }

      if (!useMessageQueueStore.getState().canAutoProcessQueue(subChatId)) {
        return
      }

      // Get the Chat object from agentChatStore
      const chat = agentChatStore.get(subChatId)
      if (!chat) {
        return
      }

      const parentChatId = agentChatStore.getParentChatId(subChatId)
      if (!parentChatId) {
        scheduleProcessing(subChatId)
        return
      }
      let checkout
      try {
        checkout = await trpcClient.chats.resolveWorktreeStatus.query({ id: parentChatId })
      } catch (error) {
        console.error("[QueueProcessor] Failed to verify queued-message checkout:", error)
        scheduleProcessing(subChatId)
        return
      }
      if (checkout.status === "unknown" || checkout.status === "replaced") {
        if (!checkoutBlockedRef.current.has(subChatId)) {
          checkoutBlockedRef.current.add(subChatId)
          toast.error(
            checkout.status === "replaced" ? "Checkout was replaced" : "Checkout unavailable",
            {
              description: checkout.error,
            },
          )
        }
        scheduleProcessing(subChatId)
        return
      }
      checkoutBlockedRef.current.delete(subChatId)

      // The checkout lookup is asynchronous. Re-read the queue gate and item so a
      // manual pause or edit that happened while it was pending cannot leak a send.
      const queueState = useMessageQueueStore.getState()
      if (!queueState.canAutoProcessQueue(subChatId)) {
        return
      }
      const nextItem = queueState.getNextItem(subChatId)
      if (!nextItem) {
        const nextRetryAt = queueState.queues[subChatId]
          ?.filter((item) => item.status === "pending" && item.nextRetryAt)
          .reduce<number | undefined>(
            (earliest, item) =>
              earliest === undefined ? item.nextRetryAt : Math.min(earliest, item.nextRetryAt!),
            undefined,
          )
        if (nextRetryAt) scheduleProcessing(subChatId, Math.max(0, nextRetryAt - Date.now()))
        return
      }

      if (!queueState.tryAcquireProcessing(subChatId)) return

      // Pop the first item from queue (atomic operation)
      const item = useMessageQueueStore.getState().popItem(subChatId, nextItem.id)
      if (!item) {
        useMessageQueueStore.getState().releaseProcessing(subChatId)
        return
      }

      try {
        const parts = buildQueuedMessageParts(item)

        // Get mode from sub-chat store for analytics
        const subChatStore = getAgentSubChatStore(parentChatId)
        const subChatMeta = subChatStore.getState().allSubChats.find((sc) => sc.id === subChatId)
        const mode = subChatMeta?.mode || "write"

        // Track message sent
        trackMessageSent({
          workspaceId: subChatId,
          messageLength: item.message.length,
          mode,
        })

        // Update timestamps
        subChatStore.getState().updateSubChatTimestamp(subChatId)

        // Set loading state for sidebar indicator
        setLoading(
          (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
          subChatId,
          parentChatId,
        )

        // Send message using Chat's sendMessage method
        await chat.sendMessage({ role: "user", parts })
      } catch (error) {
        console.error(`[QueueProcessor] Error processing queue:`, error)

        const failedItem = queueItemAfterFailure(item, error)
        useMessageQueueStore.getState().prependItem(subChatId, failedItem)

        // Clear loading state since send failed
        clearLoading(
          (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
          subChatId,
        )

        if (failedItem.status === "failed") {
          useMessageQueueStore.getState().holdQueue(subChatId)
          useStreamingStatusStore.getState().setStatus(subChatId, "ready")
          toast.error("Queued message paused after repeated failures", {
            description: failedItem.lastError,
          })
        } else {
          // The retry timer restores readiness immediately before trying again.
          useStreamingStatusStore.getState().setStatus(subChatId, "error")
          toast.error(
            `Failed to send queued message. Retrying (${failedItem.attempts}/${MAX_QUEUE_SEND_ATTEMPTS}).`,
          )
          scheduleProcessing(
            subChatId,
            Math.max(0, (failedItem.nextRetryAt ?? Date.now()) - Date.now()),
          )
        }
      } finally {
        useMessageQueueStore.getState().releaseProcessing(subChatId)
        if (useStreamingStatusStore.getState().getStatus(subChatId) !== "error") {
          setTimeout(checkAllQueues, 0)
        }
      }
    }

    // Schedule processing for a sub-chat with delay
    const scheduleProcessing = (subChatId: string, delay = QUEUE_PROCESS_DELAY) => {
      // Clear any existing timer for this sub-chat
      const existingTimer = timersRef.current.get(subChatId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Schedule new processing
      const timer = setTimeout(() => {
        timersRef.current.delete(subChatId)
        if (useStreamingStatusStore.getState().getStatus(subChatId) === "error") {
          useStreamingStatusStore.getState().setStatus(subChatId, "ready")
        }
        void processQueue(subChatId)
      }, delay)

      timersRef.current.set(subChatId, timer)
    }

    // Check all queues and schedule processing for ready sub-chats
    function checkAllQueues() {
      const queues = useMessageQueueStore.getState().queues

      for (const subChatId of Object.keys(queues)) {
        const queue = queues[subChatId]
        if (!queue || queue.length === 0) continue
        if (!useMessageQueueStore.getState().canAutoProcessQueue(subChatId)) continue

        const status = useStreamingStatusStore.getState().getStatus(subChatId)

        if (status === "ready") {
          scheduleProcessing(subChatId)
        }
      }
    }

    // Subscribe to queue changes with selector (requires subscribeWithSelector middleware)
    const unsubscribeQueue = useMessageQueueStore.subscribe(
      (state) => state.queues,
      () => checkAllQueues(),
    )
    const unsubscribeHeldQueues = useMessageQueueStore.subscribe(
      (state) => state.heldQueues,
      () => checkAllQueues(),
    )

    // Subscribe to streaming status changes with selector
    const unsubscribeStatus = useStreamingStatusStore.subscribe(
      (state) => state.statuses,
      () => checkAllQueues(),
    )

    // Initial check
    checkAllQueues()

    // Cleanup
    return () => {
      unsubscribeQueue()
      unsubscribeHeldQueues()
      unsubscribeStatus()

      // Clear all timers
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  // This component doesn't render anything
  return null
}
