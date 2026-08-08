"use client"

import { memo } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card"
import { cn } from "../../../lib/utils"

export interface AgentMessageMetadata {
  runId?: string
  transport?: string
  model?: string
  sessionId?: string
  totalCostUsd?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  finalTextId?: string
  durationMs?: number
  startedAt?: number
  resultSubtype?: string
}

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export function resolveMessageTokenUsage(metadata?: AgentMessageMetadata) {
  const inputTokens = tokenCount(metadata?.inputTokens)
  const cachedTokens =
    tokenCount(metadata?.cacheReadInputTokens) + tokenCount(metadata?.cacheCreationInputTokens)
  const outputTokens = tokenCount(metadata?.outputTokens)
  const normalizedModel = metadata?.model?.toLowerCase() ?? ""
  const inputIncludesCachedTokens =
    metadata?.transport === "codex-runtime" ||
    normalizedModel.includes("codex") ||
    normalizedModel.startsWith("gpt-")
  const totalTokens = Math.max(
    tokenCount(metadata?.totalTokens),
    inputTokens + outputTokens + (inputIncludesCachedTokens ? 0 : cachedTokens),
  )
  return { inputTokens, cachedTokens, outputTokens, totalTokens }
}

export function resolveChatTokenUsage(
  messages: ReadonlyArray<{ role?: string; metadata?: AgentMessageMetadata }>,
  latestUsage?: AgentMessageMetadata,
): number {
  const usageByRun = new Map<string, number>()
  let usageWithoutRun = 0
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const total = resolveMessageTokenUsage(message.metadata).totalTokens
    if (total === 0) continue
    const runId = message.metadata?.runId
    if (runId) usageByRun.set(runId, Math.max(usageByRun.get(runId) ?? 0, total))
    else usageWithoutRun += total
  }
  if (latestUsage) {
    const total = resolveMessageTokenUsage(latestUsage).totalTokens
    if (latestUsage.runId) {
      usageByRun.set(latestUsage.runId, Math.max(usageByRun.get(latestUsage.runId) ?? 0, total))
    } else {
      usageWithoutRun += total
    }
  }
  return usageWithoutRun + [...usageByRun.values()].reduce((sum, value) => sum + value, 0)
}

interface AgentMessageUsageProps {
  metadata?: AgentMessageMetadata
  isStreaming?: boolean
  isMobile?: boolean
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return tokens.toString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

export const AgentMessageUsage = memo(function AgentMessageUsage({
  metadata,
  isStreaming = false,
  isMobile = false,
}: AgentMessageUsageProps) {
  if (!metadata) return null

  const {
    inputTokens: rawInputTokens = 0,
    outputTokens: rawOutputTokens = 0,
    reasoningTokens,
    durationMs,
    resultSubtype,
  } = metadata

  const {
    inputTokens,
    cachedTokens,
    outputTokens,
    totalTokens: displayTokens,
  } = resolveMessageTokenUsage(metadata)

  const hasUsage = displayTokens > 0

  if (!hasUsage) return null

  return (
    <HoverCard openDelay={400} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          tabIndex={-1}
          aria-label={`Token usage${isStreaming ? ", live" : ""}: ${displayTokens.toLocaleString()}`}
          className={cn(
            "h-5 px-1.5 flex items-center text-[10px] rounded-md",
            "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50",
            "transition-[background-color,transform] duration-150 ease-out",
          )}
        >
          <span className="font-mono">{formatTokens(displayTokens)}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        sideOffset={4}
        align="end"
        className="w-auto pt-2 px-2 pb-0 shadow-sm rounded-lg border-border/50 overflow-hidden"
      >
        <div className="space-y-1.5 pb-2">
          {/* Status & Duration group */}
          {(isStreaming || resultSubtype || (durationMs !== undefined && durationMs > 0)) && (
            <div className="space-y-1">
              {isStreaming && (
                <div className="flex justify-between text-xs gap-4">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-mono text-foreground">Running</span>
                </div>
              )}
              {resultSubtype && (
                <div className="flex justify-between text-xs gap-4">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-mono text-foreground">
                    {resultSubtype === "success" ? "Success" : "Failed"}
                  </span>
                </div>
              )}

              {durationMs !== undefined && durationMs > 0 && (
                <div className="flex justify-between text-xs gap-4">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="font-mono text-foreground">{formatDuration(durationMs)}</span>
                </div>
              )}
            </div>
          )}

          {/* Tokens group */}
          {displayTokens > 0 && (
            <div className="flex justify-between text-xs gap-4 pt-1.5 mt-1 border-t border-border/50">
              <span className="text-muted-foreground">Tokens:</span>
              <span className="font-mono font-medium text-foreground">
                {displayTokens.toLocaleString()}
              </span>
            </div>
          )}
          {(rawInputTokens > 0 || rawOutputTokens > 0 || cachedTokens > 0) && (
            <div className="space-y-1 border-t border-border/50 pt-1.5">
              <UsageRow label="Input" value={inputTokens} />
              {cachedTokens > 0 && <UsageRow label="Cached input" value={cachedTokens} />}
              <UsageRow label="Output" value={outputTokens} />
            </div>
          )}
          {typeof reasoningTokens === "number" && (
            <div className="flex justify-between text-xs gap-4">
              <span className="text-muted-foreground">Reasoning tokens:</span>
              <span className="font-mono font-medium text-foreground">
                {reasoningTokens.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
})

function UsageRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-xs gap-4">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-foreground">{value.toLocaleString()}</span>
    </div>
  )
}
