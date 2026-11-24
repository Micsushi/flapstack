"use client"

import { memo } from "react"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"

// Pre-computed token data to avoid re-computing on every render
export interface MessageTokenData {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  messageCount: number
  contextWindow?: number
  totalChatTokens?: number
  autoCompactThreshold?: number
  autoCompactEnabled?: boolean
}

interface AgentContextIndicatorProps {
  tokenData: MessageTokenData
  className?: string
  onCompact?: () => void
  isCompacting?: boolean
  disabled?: boolean
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`
  }
  return tokens.toString()
}

// Circular progress component
function CircularProgress({
  percent,
  size = 18,
  strokeWidth = 2,
  className,
}: {
  percent: number
  size?: number
  strokeWidth?: number
  className?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <svg width={size} height={size} className={cn("transform -rotate-90", className)}>
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-300 text-muted-foreground/60"
      />
    </svg>
  )
}

export const AgentContextIndicator = memo(function AgentContextIndicator({
  tokenData,
  className,
  onCompact,
  isCompacting,
  disabled,
}: AgentContextIndicatorProps) {
  const contextTokens = tokenData.totalInputTokens
  const contextWindow = tokenData.contextWindow
  const percentUsed = contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : 0
  const threshold = tokenData.autoCompactThreshold
  const autoCompact =
    tokenData.autoCompactEnabled === false
      ? "Disabled"
      : threshold !== undefined
        ? `${threshold.toLocaleString()} tokens`
        : "Threshold unavailable"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Context usage"
          className={cn(
            "flex size-7 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            className,
          )}
        >
          <CircularProgress
            percent={percentUsed}
            size={14}
            strokeWidth={2.5}
            className={isCompacting ? "animate-pulse motion-reduce:animate-none" : undefined}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Context usage"
        side="top"
        sideOffset={8}
        align="end"
        className="w-60 max-w-[calc(100vw-2rem)] p-3 text-xs"
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">Context</dt>
          <dd>
            {formatTokens(contextTokens)}
            {contextWindow ? ` / ${formatTokens(contextWindow)}` : ""} tokens
          </dd>
          <dt className="text-muted-foreground">Chat total</dt>
          <dd>{(tokenData.totalChatTokens ?? 0).toLocaleString()} tokens</dd>
          <dt className="text-muted-foreground">Auto-compact</dt>
          <dd>{autoCompact}</dd>
          <dt className="text-muted-foreground">Manual /compact</dt>
          <dd>{onCompact ? "Available" : "Unavailable"}</dd>
        </dl>
        {onCompact && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            disabled={disabled || isCompacting || tokenData.messageCount === 0}
            onClick={onCompact}
          >
            {isCompacting ? "Compacting..." : "Compact context"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
})
