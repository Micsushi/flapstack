"use client"

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react"
import { useAtomValue } from "jotai"
import { messageGroupsPerChatAtom, userMessageIdsPerChatAtom } from "../stores/message-store"
import { IsolatedMessageGroup } from "./isolated-message-group"
import { useStreamingStatusStore } from "../stores/streaming-status-store"

// ============================================================================
// ISOLATED MESSAGES SECTION (LAYER 3)
// ============================================================================
// Retains the complete group index while mounting only a measured, overscanned
// window against the owning Chat pane's real scroll container.
//
// During streaming:
// - This component does NOT re-render (userMessageIds don't change)
// - Individual groups don't re-render (their user msg + assistant IDs don't change)
// - Only the AssistantMessageItem for the streaming message re-renders
// ============================================================================

export interface MessageVirtualizerHandle {
  scrollToMessage: (
    messageId: string,
    options?: { align?: "start" | "center" | "end"; focus?: boolean },
  ) => boolean
  getMountedGroupCount: () => number
  getTotalGroupCount: () => number
}

export function findVisibleTranscriptAnchor(
  renderedItems: Array<{ key: string; start: number }>,
  scrollTop: number,
): { key: string; viewportOffset: number } | null {
  const renderedAnchor =
    renderedItems
      .filter((item) => item.start <= scrollTop)
      .sort((left, right) => right.start - left.start)[0] ?? renderedItems[0]
  return renderedAnchor
    ? {
        key: renderedAnchor.key,
        viewportOffset: renderedAnchor.start - scrollTop,
      }
    : null
}

interface IsolatedMessagesSectionProps {
  subChatId: string
  chatId: string
  isMobile: boolean
  sandboxSetupStatus: "cloning" | "ready" | "error"
  stickyTopClass: string
  sandboxSetupError?: string
  onRetrySetup?: () => void
  onRollback?: (msg: any) => void
  onEditLatest?: (msg: any, text: string) => Promise<boolean>
  onFork?: (messageId: string) => void
  // Components passed from parent - must be stable references
  UserBubbleComponent: React.ComponentType<{
    messageId: string
    textContent: string
    imageParts: any[]
    skipTextMentionBlocks?: boolean
  }>
  ToolCallComponent: React.ComponentType<{
    icon: any
    title: string
    isPending: boolean
    isError: boolean
  }>
  MessageGroupWrapper: React.ComponentType<{
    children: React.ReactNode
    isLastGroup?: boolean
    hasStickyContent?: boolean
  }>
  toolRegistry: Record<string, { icon: any; title: (args: any) => string }>
  scrollElementRef?: RefObject<HTMLElement | null>
  virtualizerRef?: Ref<MessageVirtualizerHandle>
}

function areSectionPropsEqual(
  prev: IsolatedMessagesSectionProps,
  next: IsolatedMessagesSectionProps,
): boolean {
  return (
    prev.subChatId === next.subChatId &&
    prev.chatId === next.chatId &&
    prev.isMobile === next.isMobile &&
    prev.sandboxSetupStatus === next.sandboxSetupStatus &&
    prev.stickyTopClass === next.stickyTopClass &&
    prev.sandboxSetupError === next.sandboxSetupError &&
    prev.onRetrySetup === next.onRetrySetup &&
    prev.onRollback === next.onRollback &&
    prev.onEditLatest === next.onEditLatest &&
    prev.onFork === next.onFork &&
    prev.UserBubbleComponent === next.UserBubbleComponent &&
    prev.ToolCallComponent === next.ToolCallComponent &&
    prev.MessageGroupWrapper === next.MessageGroupWrapper &&
    prev.toolRegistry === next.toolRegistry &&
    prev.scrollElementRef === next.scrollElementRef &&
    prev.virtualizerRef === next.virtualizerRef
  )
}

export const IsolatedMessagesSection = memo(function IsolatedMessagesSection({
  subChatId,
  chatId,
  isMobile,
  sandboxSetupStatus,
  stickyTopClass,
  sandboxSetupError,
  onRetrySetup,
  onRollback,
  onEditLatest,
  onFork,
  UserBubbleComponent,
  ToolCallComponent,
  MessageGroupWrapper,
  toolRegistry,
  scrollElementRef,
  virtualizerRef,
}: IsolatedMessagesSectionProps) {
  // Per-subchat selector - split panes render fully independently.
  const userMsgIds = useAtomValue(userMessageIdsPerChatAtom(subChatId))
  const messageGroups = useAtomValue(messageGroupsPerChatAtom(subChatId))
  const sectionRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const subChatStatus = useStreamingStatusStore(
    useCallback((state) => state.statuses[subChatId] ?? "ready", [subChatId]),
  )
  const isStreaming = subChatStatus === "streaming" || subChatStatus === "submitted"
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range)
      const tail = userMsgIds.length - 1
      if (!isStreaming || tail < 0 || indexes.includes(tail)) return indexes
      return [...indexes, tail]
    },
    [isStreaming, userMsgIds.length],
  )
  const virtualizer = useVirtualizer({
    count: userMsgIds.length,
    getScrollElement: () => scrollElementRef?.current ?? null,
    getItemKey: (index) => userMsgIds[index] ?? index,
    estimateSize: () => 240,
    overscan: 6,
    rangeExtractor,
    scrollMargin,
    anchorTo: "end",
    enabled: Boolean(scrollElementRef),
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const section = sectionRef.current
    const nextScrollElement = scrollElementRef?.current ?? null
    setScrollElement(nextScrollElement)
    if (!section || !nextScrollElement) {
      setScrollMargin(0)
      return
    }
    const updateMargin = () => {
      const sectionRect = section.getBoundingClientRect()
      const scrollRect = nextScrollElement.getBoundingClientRect()
      setScrollMargin(sectionRect.top - scrollRect.top + nextScrollElement.scrollTop)
    }
    updateMargin()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateMargin)
    observer.observe(nextScrollElement)
    observer.observe(section)
    if (section.parentElement) observer.observe(section.parentElement)
    return () => observer.disconnect()
  }, [scrollElementRef, subChatId])

  const groupIndexByMessageId = useMemo(() => {
    const indexes = new Map<string, number>()
    messageGroups.forEach((group, index) => {
      indexes.set(group.userMsgId, index)
      for (const assistantMsgId of group.assistantMsgIds) indexes.set(assistantMsgId, index)
    })
    return indexes
  }, [messageGroups])
  const focusMessageAfterMount = useCallback(
    (messageId: string) => {
      let attempts = 0
      let previousTarget: HTMLElement | null = null
      let stableFrames = 0
      const focus = () => {
        const target = Array.from(
          scrollElement?.querySelectorAll<HTMLElement>(
            "[data-user-message-id], [data-assistant-message-id]",
          ) ?? [],
        ).find(
          (element) =>
            element.dataset.userMessageId === messageId ||
            element.dataset.assistantMessageId === messageId,
        )
        if (target) {
          if (!target.hasAttribute("tabindex")) target.tabIndex = -1
          target.focus({ preventScroll: true })
          stableFrames = target === previousTarget ? stableFrames + 1 : 1
          previousTarget = target
          if (stableFrames >= 8) return
        } else {
          previousTarget = null
          stableFrames = 0
        }
        attempts += 1
        if (attempts < 30) requestAnimationFrame(focus)
      }
      requestAnimationFrame(focus)
    },
    [scrollElement],
  )
  useImperativeHandle(
    virtualizerRef,
    () => ({
      scrollToMessage(messageId, options) {
        const index = groupIndexByMessageId.get(messageId)
        if (index === undefined || !scrollElement) return false
        const align = options?.align ?? "center"
        const offset = virtualizer.getOffsetForIndex(index, align)?.[0]
        if (offset === undefined) return false
        virtualizer.scrollToIndex(index, { align, behavior: "auto" })
        if (options?.focus) focusMessageAfterMount(messageId)
        return true
      },
      getMountedGroupCount: () => virtualizer.getVirtualItems().length,
      getTotalGroupCount: () => userMsgIds.length,
    }),
    [focusMessageAfterMount, groupIndexByMessageId, scrollElement, userMsgIds.length, virtualizer],
  )

  return (
    <div
      ref={sectionRef}
      role="feed"
      aria-busy={isStreaming}
      aria-label="Chat transcript"
      data-total-message-groups={userMsgIds.length}
      data-mounted-message-groups={virtualItems.length}
      data-virtualization-ready={Boolean(scrollElement) || undefined}
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const userMsgId = userMsgIds[virtualItem.index]
        if (!userMsgId) return null
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            role="article"
            aria-label={`Conversation turn ${virtualItem.index + 1} of ${userMsgIds.length}`}
            aria-posinset={virtualItem.index + 1}
            aria-setsize={userMsgIds.length}
            data-index={virtualItem.index}
            data-virtual-message-group={userMsgId}
            className="absolute left-0 w-full"
            style={{
              top: `${virtualItem.start - scrollMargin}px`,
            }}
          >
            <IsolatedMessageGroup
              userMsgId={userMsgId}
              subChatId={subChatId}
              chatId={chatId}
              isMobile={isMobile}
              sandboxSetupStatus={sandboxSetupStatus}
              stickyTopClass={stickyTopClass}
              sandboxSetupError={sandboxSetupError}
              onRetrySetup={onRetrySetup}
              onRollback={onRollback}
              onEditLatest={onEditLatest}
              onFork={onFork}
              UserBubbleComponent={UserBubbleComponent}
              ToolCallComponent={ToolCallComponent}
              MessageGroupWrapper={MessageGroupWrapper}
              toolRegistry={toolRegistry}
            />
          </div>
        )
      })}
    </div>
  )
}, areSectionPropsEqual)
