"use client"

import { memo, useState, useEffect, useRef } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "../../../lib/utils"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { AgentToolInterrupted } from "./agent-tool-interrupted"
import { areToolPropsEqual } from "./agent-tool-utils"
import { formatReasoningStatus } from "../lib/reasoning-duration"

interface ReasoningOutputPart {
  type: string
  state: string
  label?: "Reasoning output" | "Reasoning summary" | "Reasoning tokens" | null
  tokens?: number
  input?: {
    text?: string
  }
  output?: {
    completed?: boolean
    durationMs?: number
  }
  result?: {
    completed?: boolean
    durationMs?: number
  }
  startedAt?: number
  callProviderMetadata?: {
    custom?: { startedAt?: number }
  }
  providerMetadata?: {
    custom?: { startedAt?: number }
  }
}

interface AgentReasoningOutputProps {
  part: ReasoningOutputPart
  chatStatus?: string
  durationMs?: number
  startedAt?: number
}

function areReasoningPropsEqual(
  prevProps: AgentReasoningOutputProps,
  nextProps: AgentReasoningOutputProps,
): boolean {
  if (prevProps.durationMs !== nextProps.durationMs) return false
  if (prevProps.startedAt !== nextProps.startedAt) return false
  return areToolPropsEqual(prevProps, nextProps)
}

export const AgentReasoningOutput = memo(function AgentReasoningOutput({
  part,
  chatStatus,
  durationMs,
  startedAt,
}: AgentReasoningOutputProps) {
  const isPending = part.state !== "output-available" && part.state !== "output-error"
  const isActivelyStreaming = chatStatus === "streaming" || chatStatus === "submitted"
  const isStreaming = isPending && isActivelyStreaming
  const isInterrupted = isPending && !isActivelyStreaming && chatStatus !== undefined

  // Default: expanded while streaming, collapsed when done
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasStreamingRef = useRef(isStreaming)

  // Auto-collapse when streaming ends (transition from true -> false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsExpanded(false)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  // Prefer adapter timestamps, then fall back to when this visible reasoning row mounted.
  const startedAtRef = useRef(
    startedAt ||
      part.startedAt ||
      part.callProviderMetadata?.custom?.startedAt ||
      part.providerMetadata?.custom?.startedAt ||
      Date.now(),
  )
  const [elapsedMs, setElapsedMs] = useState(() => durationMs ?? 0)
  const hasStreamedRef = useRef(isStreaming)

  useEffect(() => {
    if (!isStreaming) {
      if (hasStreamedRef.current) {
        setElapsedMs(Date.now() - startedAtRef.current)
      }
      return
    }

    hasStreamedRef.current = true
    const tick = () => setElapsedMs(Date.now() - startedAtRef.current)
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isStreaming])

  // Persisted whole-run duration is more accurate and survives history reloads.
  useEffect(() => {
    if (!isStreaming && durationMs !== undefined && durationMs >= 0) {
      setElapsedMs(durationMs)
    }
  }, [durationMs, isStreaming])

  // Track whether content overflows the scroll container
  const [isOverflowing, setIsOverflowing] = useState(false)

  // Auto-scroll when expanded during streaming + check overflow
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      const el = scrollRef.current
      setIsOverflowing(el.scrollHeight > el.clientHeight)
      el.scrollTop = el.scrollHeight
    }
  }, [part.input?.text, isStreaming, isExpanded])

  const reasoningOutputText = part.input?.text || ""
  const reasoningOutputLabel = part.label || "Reasoning output"
  const tokenLabel = typeof part.tokens === "number" ? `${part.tokens.toLocaleString()} tokens` : ""

  const completedDurationMs =
    durationMs ??
    part.output?.durationMs ??
    part.result?.durationMs ??
    (elapsedMs > 0 ? elapsedMs : undefined)
  const statusLabel = formatReasoningStatus(
    isStreaming,
    isStreaming ? elapsedMs : completedDurationMs,
  )

  if (isInterrupted && !reasoningOutputText) {
    return <AgentToolInterrupted toolName="Reasoning output" />
  }

  if (!isStreaming && !reasoningOutputText.trim()) return null

  return (
    <div className="mb-3">
      {/* Header - always visible, clickable to toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="group flex w-full items-center gap-2 border-b border-border/60 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {isStreaming ? (
            <TextShimmer as="span" duration={1.2} className="text-sm">
              {statusLabel}
            </TextShimmer>
          ) : (
            statusLabel
          )}
        </span>
        {reasoningOutputLabel !== "Reasoning output" && (
          <span className="shrink-0 text-xs text-muted-foreground/60">{reasoningOutputLabel}</span>
        )}
        {tokenLabel && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
            {tokenLabel}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            isExpanded && "rotate-90",
          )}
        />
      </button>

      {/* Content - expanded while streaming, collapsible after */}
      {isExpanded && reasoningOutputText && (
        <div className="relative pt-3">
          {/* Top gradient fade when streaming */}
          <div
            className={cn(
              "absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
              isStreaming && isOverflowing ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            ref={scrollRef}
            className={cn(isStreaming && "overflow-y-auto scrollbar-hide max-h-36")}
          >
            <ChatMarkdownRenderer
              content={reasoningOutputText}
              size="sm"
              isStreaming={isStreaming}
            />
          </div>
        </div>
      )}
    </div>
  )
}, areReasoningPropsEqual)
