"use client"

import { useAtomValue } from "jotai"
import { ChevronRight, MoreHorizontal } from "lucide-react"
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { normalizeCodexToolPart } from "../../../../shared/codex-tool-normalizer"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { PlanIcon } from "../../../components/ui/icons"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { cn } from "../../../lib/utils"
import { selectedProjectAtom, showMessageJsonAtom } from "../atoms"
import { MessageJsonDisplay } from "../ui/message-json-display"
import { AgentAskUserQuestionTool } from "../ui/agent-ask-user-question-tool"
import { AgentBashTool } from "../ui/agent-bash-tool"
import { AgentEditTool } from "../ui/agent-edit-tool"
import { AgentExploringGroup } from "../ui/agent-exploring-group"
import { AgentTaskToolsGroup } from "../ui/agent-task-tools"
import { AgentPlanFileTool } from "../ui/agent-plan-file-tool"
import { isPlanFile } from "../ui/agent-tool-utils"
import { AgentMessageUsage, type AgentMessageMetadata } from "../ui/agent-message-usage"
import { AgentPlanTool } from "../ui/agent-plan-tool"
import { AgentTaskTool } from "../ui/agent-task-tool"
import { AgentReasoningOutput } from "../ui/agent-reasoning-output"
import { AgentChangedFilesCard } from "../ui/agent-changed-files-card"
import { AgentTodoTool } from "../ui/agent-todo-tool"
import { AgentMcpToolCall } from "../ui/agent-mcp-tool-call"
import { AgentToolCall } from "../ui/agent-tool-call"
import { AgentToolRegistry, getToolStatus, parseMcpToolType } from "../ui/agent-tool-registry"
import { AgentWebFetchTool } from "../ui/agent-web-fetch-tool"
import { AgentWebSearchCollapsible } from "../ui/agent-web-search-collapsible"
import { CopyButton, PlayButton, getMessageTextContent } from "../ui/message-action-buttons"
import { useFileOpen } from "../mentions"
import { GitActivityBadges } from "../ui/git-activity-badges"
import { formatPermissionMode, getHarnessChipMeta } from "../constants"
import { ProviderChipIcon } from "../components/provider-chip-icon"
import { formatModelDisplayName } from "../../../../shared/model-catalog"
import { dedupeVisibleReasoningParts, getVisibleReasoningText } from "../lib/reasoning-parts"
import { formatReasoningStatus, getReasoningStartedAt } from "../lib/reasoning-duration"
import { ForkContext } from "./isolated-message-group"
import { MemoizedTextPart } from "./memoized-text-part"
import { formatMessageTimestamp } from "../lib/message-timestamp"

// Map first word of an ACP tool title to a canonical Claude Code tool type.
// Codex tool calls arrive with type = "tool-Read README.md", "tool-Run echo ---",
// "tool-List /Users/...", "tool-Search *.test.ts in backend", etc.
// input.toolName contains the full ACP title, input.args the raw codex parameters.
const ACP_VERB_TO_TOOL_TYPE: Record<string, string> = {
  Read: "Read",
  Run: "Bash",
  List: "Glob",
  Search: "Grep",
  Grep: "Grep",
  Glob: "Glob",
  Edit: "Edit",
  Write: "Write",
  Thought: "ReasoningOutput",
  Fetch: "WebFetch",
}

const PROVIDER_TOOL_TO_CANONICAL_TYPE: Record<string, string> = {
  apply_patch: "Edit",
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  read: "Read",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  write: "Write",
}

// Check if a part.type looks like an ACP title-based type (e.g. "tool-Read README.md")
// Returns the verb if matched, null otherwise
function getAcpVerb(partType: string): string | null {
  if (!partType.startsWith("tool-")) return null
  const afterTool = partType.slice(5) // strip "tool-"
  // Check if it starts with a known verb followed by space or end-of-string
  for (const verb of Object.keys(ACP_VERB_TO_TOOL_TYPE)) {
    if (afterTool === verb || afterTool.startsWith(verb + " ")) {
      return verb
    }
  }
  return null
}

// Normalize ACP/codex tool parts into canonical types so grouping and rendering work.
// Handles two formats:
// 1. Streaming: type="tool-acp.acp_provider_agent_dynamic_tool", input={toolName, args}
// 2. Persisted/live: type="tool-Read README.md", input={toolName, args}
function normalizeAcpParts(parts: any[]): any[] {
  return parts.map((part) => {
    if (!part.type?.startsWith("tool-")) return part

    const rawToolName = part.type.slice(5)
    const providerCanonicalType = PROVIDER_TOOL_TO_CANONICAL_TYPE[rawToolName.toLowerCase()]
    if (providerCanonicalType) {
      return { ...part, type: `tool-${providerCanonicalType}` }
    }

    // Guard: only process ACP parts, not Claude Code parts.
    // ACP parts have: input.toolName, or space in type (e.g. "tool-Read README.md"),
    // or the proxy tool name. Claude Code parts have exact types like "tool-Read".
    const isAcpPart =
      part.input?.toolName ||
      part.type.includes(" ") ||
      part.type === "tool-acp.acp_provider_agent_dynamic_tool"
    if (!isAcpPart) return part

    const partInput =
      part.input && typeof part.input === "object" ? (part.input as Record<string, any>) : {}

    // Determine the ACP title - either from the type itself or from input.toolName
    let title: string | null = null
    let args: Record<string, any> = {}

    // Case 1: type is already the title-based type (e.g. "tool-Read README.md")
    const verb = getAcpVerb(part.type)
    if (verb) {
      title = partInput.toolName || part.type.slice(5)
      args =
        partInput.args && typeof partInput.args === "object"
          ? (partInput.args as Record<string, any>)
          : partInput
    }

    // Case 2: type is the ACP proxy tool name
    if (!verb && part.type === "tool-acp.acp_provider_agent_dynamic_tool") {
      let input = part.input
      if (typeof input === "string") {
        try {
          input = JSON.parse(input)
        } catch {
          return part
        }
      }
      const parsedInput = input && typeof input === "object" ? (input as Record<string, any>) : {}
      if (parsedInput.toolName) {
        title = parsedInput.toolName
        args =
          parsedInput.args && typeof parsedInput.args === "object"
            ? (parsedInput.args as Record<string, any>)
            : parsedInput
      }
    }

    if (!title) return part

    // Parse the first word of the title to get canonical tool type
    const spaceIdx = title.indexOf(" ")
    const titleVerb = spaceIdx === -1 ? title : title.slice(0, spaceIdx)
    const detail = spaceIdx === -1 ? "" : title.slice(spaceIdx + 1)
    const canonicalType = ACP_VERB_TO_TOOL_TYPE[titleVerb]

    if (!canonicalType) return part

    // Enrich input with fields that the tool registry expects for display
    const enrichedInput: Record<string, any> = { ...args, _acpTitle: title, _acpDetail: detail }
    if (canonicalType === "Read" && !enrichedInput.file_path && detail) {
      enrichedInput.file_path = detail
    }
    if (canonicalType === "Bash") {
      // Codex passes command as array ['/bin/zsh', '-lc', 'actual command'] - extract shell string
      if (Array.isArray(enrichedInput.command)) {
        enrichedInput.command = enrichedInput.command[enrichedInput.command.length - 1] || detail
      } else if (!enrichedInput.command && detail) {
        enrichedInput.command = detail
      }
    }
    if (canonicalType === "Grep" && !enrichedInput.pattern && detail) {
      enrichedInput.pattern = detail
    }
    if (canonicalType === "Glob" && !enrichedInput.pattern && detail) {
      enrichedInput.pattern = detail
    }

    return {
      ...part,
      type: `tool-${canonicalType}`,
      input: enrichedInput,
      output: part.output,
    }
  })
}

// Exploring tools - these get grouped when 3+ consecutive
const EXPLORING_TOOLS = new Set([
  "tool-Read",
  "tool-Grep",
  "tool-Glob",
  "tool-WebSearch",
  "tool-WebFetch",
])

// Task management tools - these get grouped when consecutive
const TASK_TOOLS = new Set(["tool-TaskCreate", "tool-TaskUpdate", "tool-TaskGet", "tool-TaskList"])

const STREAMING_REASONING_STATES = new Set(["streaming", "in_progress", "input-streaming"])
const DONE_REASONING_STATES = new Set(["done", "completed", "result", "output-available"])
const ERROR_REASONING_STATES = new Set(["error", "output-error"])

function mapReasoningStateToOutputState(state: unknown): string {
  if (typeof state !== "string") {
    return "output-available"
  }

  const normalized = state.trim().toLowerCase()
  if (STREAMING_REASONING_STATES.has(normalized)) return "input-streaming"
  if (DONE_REASONING_STATES.has(normalized)) return "output-available"
  if (ERROR_REASONING_STATES.has(normalized)) return "output-error"
  return "output-available"
}

function getReasoningOutputText(part: any): string {
  return getVisibleReasoningText(part)
}

function isReasoningPart(part: any): boolean {
  return (
    part?.type === "reasoning" ||
    part?.type === "tool-ReasoningOutput" ||
    part?.type === "tool-Thinking"
  )
}

function toReasoningOutputPart(part: any, messageId: string | undefined, index: number): any {
  const normalizedState = mapReasoningStateToOutputState(part.state)
  const text = getReasoningOutputText(part)
  const normalizedPart = {
    ...part,
    type: "tool-ReasoningOutput",
    toolCallId:
      typeof part.toolCallId === "string" && part.toolCallId.length > 0
        ? part.toolCallId
        : typeof part.id === "string" && part.id.length > 0
          ? part.id
          : `reasoning-${messageId || "message"}-${index}`,
    toolName: typeof part.toolName === "string" ? part.toolName : "ReasoningOutput",
    input: {
      ...(part.input && typeof part.input === "object" ? part.input : {}),
      text,
    },
    label:
      typeof part.label === "string"
        ? part.label
        : typeof part.input?.label === "string"
          ? part.input.label
          : undefined,
    tokens:
      typeof part.tokens === "number"
        ? part.tokens
        : typeof part.input?.tokens === "number"
          ? part.input.tokens
          : undefined,
    state: normalizedState,
  }

  if (normalizedState !== "output-available") {
    return normalizedPart
  }

  const completedResult = { completed: true }
  return {
    ...normalizedPart,
    result: normalizedPart.result ?? completedResult,
    output: normalizedPart.output ?? completedResult,
  }
}

// Group consecutive exploring tools into exploring-group
function groupExploringTools(parts: any[], nestedToolIds: Set<string>): any[] {
  const result: any[] = []
  let currentGroup: any[] = []

  for (const part of parts) {
    const isNested = part.toolCallId && nestedToolIds.has(part.toolCallId)

    if (EXPLORING_TOOLS.has(part.type) && !isNested) {
      currentGroup.push(part)
    } else {
      if (currentGroup.length >= 3) {
        result.push({ type: "exploring-group", parts: currentGroup })
      } else {
        result.push(...currentGroup)
      }
      currentGroup = []
      result.push(part)
    }
  }
  if (currentGroup.length >= 3) {
    result.push({ type: "exploring-group", parts: currentGroup })
  } else {
    result.push(...currentGroup)
  }
  return result
}

// Group consecutive task tools into task-group
function groupTaskTools(parts: any[], nestedToolIds: Set<string>): any[] {
  const result: any[] = []
  let currentGroup: any[] = []

  for (const part of parts) {
    const isNested = part.toolCallId && nestedToolIds.has(part.toolCallId)

    if (TASK_TOOLS.has(part.type) && !isNested) {
      currentGroup.push(part)
    } else {
      if (currentGroup.length >= 1) {
        result.push({ type: "task-group", parts: currentGroup })
      }
      currentGroup = []
      result.push(part)
    }
  }
  if (currentGroup.length >= 1) {
    result.push({ type: "task-group", parts: currentGroup })
  }
  return result
}

function isGroupableToolActivity(part: any, nestedToolIds: Set<string>): boolean {
  return (
    part?.type?.startsWith("tool-") &&
    part.type !== "tool-ExitPlanMode" &&
    !isReasoningPart(part) &&
    !(part.toolCallId && nestedToolIds.has(part.toolCallId))
  )
}

function groupToolActivities(parts: any[], nestedToolIds: Set<string>): any[] {
  const result: any[] = []
  let current: any[] = []

  const flush = () => {
    if (current.length >= 1) result.push({ type: "activity-group", parts: current })
    else result.push(...current)
    current = []
  }

  for (const part of parts) {
    if (part?.type === "step-start" || part?.type === "tool-TaskOutput") continue
    if (isGroupableToolActivity(part, nestedToolIds)) current.push(part)
    else {
      flush()
      result.push(part)
    }
  }
  flush()
  return result
}

function summarizeToolActivities(parts: any[]): string {
  let edits = 0
  let reads = 0
  let commands = 0
  let tools = 0

  for (const part of parts) {
    const type = String(part.type).toLowerCase()
    if (type === "tool-edit" || type === "tool-write" || type === "tool-apply_patch") edits++
    else if (
      ["tool-read", "tool-grep", "tool-glob", "tool-websearch", "tool-webfetch"].includes(type)
    )
      reads++
    else if (type === "tool-bash") commands++
    else tools++
  }

  const summary: string[] = []
  if (edits) summary.push(edits === 1 ? "Edited a file" : `Edited ${edits} files`)
  if (reads) summary.push(reads === 1 ? "Read a file" : `Read ${reads} files`)
  if (commands) summary.push(commands === 1 ? "Ran a command" : `Ran ${commands} commands`)
  if (tools) summary.push(tools === 1 ? "Used a tool" : `Used ${tools} tools`)
  return summary.join(", ")
}

interface ToolActivityGroupProps {
  parts: any[]
  isStreaming: boolean
  children: React.ReactNode
}

function ToolActivityGroup({ parts, isStreaming, children }: ToolActivityGroupProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const wasStreamingRef = useRef(isStreaming)

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) setIsExpanded(false)
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  return (
    <div className="mx-2 overflow-hidden rounded-md bg-muted/35">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{summarizeToolActivities(parts)}</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      {isExpanded && <div className="space-y-1.5 border-t border-border/60 py-2">{children}</div>}
    </div>
  )
}

// Collapsible steps component
interface ReasoningTimelineProps {
  children: React.ReactNode
  isStreaming: boolean
  durationMs?: number
  startedAt: number
}

function ReasoningTimeline({
  children,
  isStreaming,
  durationMs,
  startedAt,
}: ReasoningTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const [elapsedMs, setElapsedMs] = useState(durationMs ?? 0)
  const wasStreamingRef = useRef(isStreaming)

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) setIsExpanded(false)
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  useEffect(() => {
    if (!isStreaming) {
      if (durationMs !== undefined) setElapsedMs(durationMs)
      return
    }
    const tick = () => setElapsedMs(Date.now() - startedAt)
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [durationMs, isStreaming, startedAt])

  const label = formatReasoningStatus(isStreaming, isStreaming ? elapsedMs : durationMs)

  return (
    <div
      className={cn(
        "mb-2",
        isExpanded &&
          "overflow-hidden rounded-lg border border-border bg-muted/30 shadow-[0_0_0_1px_hsl(var(--border)/0.2)]",
      )}
      data-reasoning-timeline="true"
    >
      <button
        type="button"
        className="group flex w-full items-center gap-2 border-b border-border/60 px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
      >
        <span className="min-w-0 flex-1 truncate tabular-nums">
          {isStreaming ? (
            <TextShimmer as="span" duration={1.2} className="text-sm">
              {label}
            </TextShimmer>
          ) : (
            label
          )}
        </span>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200 ease-out",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      {isExpanded && <div className="space-y-1.5 px-1 py-3">{children}</div>}
    </div>
  )
}

// ============================================================================
// ASSISTANT MESSAGE ITEM - MEMOIZED BY MESSAGE ID + PARTS LENGTH
// ============================================================================

export interface AssistantMessageItemProps {
  message: any
  isLastMessage: boolean
  isStreaming: boolean
  status: string
  isMobile: boolean
  subChatId: string
  chatId: string
  sandboxSetupStatus?: "cloning" | "ready" | "error"
}

// Cache for tracking previous message state per sub-chat/message
// (to detect AI SDK in-place mutations without cross-chat collisions)
// Stores both text lengths and tool states for complete change detection
interface MessageStateSnapshot {
  textLengths: number[]
  partStates: (string | undefined)[]
  lastPartInputJson: string | undefined
  metadataJson: string | undefined
}
const messageStateCache = new Map<string, MessageStateSnapshot>()

export function clearMessageStateCacheByMessageIds(subChatId: string, messageIds: string[]) {
  for (const id of messageIds) {
    messageStateCache.delete(`${subChatId}:${id}`)
  }
}

function getTrackedPartTextLength(part: any): number {
  if (part?.type === "text") {
    return typeof part.text === "string" ? part.text.length : 0
  }

  if (part?.type === "reasoning") {
    return typeof part.text === "string" ? part.text.length : 0
  }

  if (part?.type === "tool-ReasoningOutput" || part?.type === "tool-Thinking") {
    if (typeof part?.input?.text === "string") return part.input.text.length
    if (typeof part?.text === "string") return part.text.length
    return 0
  }

  return -1
}

// Custom comparison - check if message content actually changed
// CRITICAL: AI SDK mutates objects in-place! So prev.message.parts[i].text === next.message.parts[i].text
// even when text HAS changed (they're the same mutated object).
// Solution: Cache state externally and compare those.
function areMessagePropsEqual(
  prev: AssistantMessageItemProps,
  next: AssistantMessageItemProps,
): boolean {
  const msgId = next.message?.id
  const cacheKey = msgId ? `${next.subChatId}:${msgId}` : null

  // Different message ID = different message
  if (prev.message?.id !== next.message?.id) {
    return false
  }

  // Check other props first (cheap comparisons)
  if (prev.status !== next.status) return false
  if (prev.isStreaming !== next.isStreaming) return false
  if (prev.isLastMessage !== next.isLastMessage) return false
  if (prev.isMobile !== next.isMobile) return false
  if (prev.subChatId !== next.subChatId) return false
  if (prev.chatId !== next.chatId) return false
  if (prev.sandboxSetupStatus !== next.sandboxSetupStatus) return false

  // Get current message state from parts
  const nextParts = next.message?.parts || []
  const lastPart = nextParts[nextParts.length - 1]

  const currentState: MessageStateSnapshot = {
    textLengths: nextParts.map((p: any) => getTrackedPartTextLength(p)),
    // Track ALL part states - critical for detecting Edit plan file streaming!
    partStates: nextParts.map((p: any) => p.state),
    // Track tool input changes - this is critical for tool streaming!
    lastPartInputJson: lastPart?.input ? JSON.stringify(lastPart.input) : undefined,
    metadataJson: next.message?.metadata ? JSON.stringify(next.message.metadata) : undefined,
  }

  // Get cached state from previous render
  const cachedState = cacheKey ? messageStateCache.get(cacheKey) : undefined

  // If no cache, this is first comparison - cache and allow render
  if (!cachedState) {
    if (cacheKey) messageStateCache.set(cacheKey, currentState)
    return false // First render - must render
  }

  // Compare parts count
  if (cachedState.textLengths.length !== currentState.textLengths.length) {
    messageStateCache.set(cacheKey!, currentState)
    return false // Parts count changed
  }

  // Compare text lengths (detects streaming text changes!)
  for (let i = 0; i < currentState.textLengths.length; i++) {
    if (cachedState.textLengths[i] !== currentState.textLengths[i]) {
      messageStateCache.set(cacheKey!, currentState)
      return false // Text length changed = content changed
    }
  }

  // Compare last part's input (detects tool input streaming!)
  if (cachedState.lastPartInputJson !== currentState.lastPartInputJson) {
    messageStateCache.set(cacheKey!, currentState)
    return false // Tool input changed
  }

  if (cachedState.metadataJson !== currentState.metadataJson) {
    messageStateCache.set(cacheKey!, currentState)
    return false // Model/run metadata changed
  }

  // Compare ALL part states (detects Edit plan file streaming!)
  for (let i = 0; i < currentState.partStates.length; i++) {
    if (cachedState.partStates[i] !== currentState.partStates[i]) {
      messageStateCache.set(cacheKey!, currentState)
      return false // Part state changed
    }
  }

  // Nothing changed - skip re-render
  return true
}

function ProducerChips({ metadata }: { metadata: AgentMessageMetadata | undefined }) {
  const rawMetadata = metadata as
    | (AgentMessageMetadata & {
        harness?: string
        model?: string
        permissionMode?: string
        worktreePath?: string | null
      })
    | null
  const harness = rawMetadata?.harness
  const model = rawMetadata?.model
  const permissionMode = rawMetadata?.permissionMode
  const worktreePath = rawMetadata?.worktreePath

  if (!harness && !model && !permissionMode && !worktreePath) {
    return null
  }

  const harnessMeta = getHarnessChipMeta(harness)
  const worktreeName = worktreePath?.split(/[\\/]/).filter(Boolean).at(-1)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 pb-1">
      <span
        title={model ? `${harnessMeta.name} · ${model}` : harnessMeta.name}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
          harnessMeta.className,
        )}
      >
        <ProviderChipIcon provider={harness} className="h-2.5 w-2.5 shrink-0" />
        {formatModelDisplayName(model) || "Unknown model"}
      </span>
      {permissionMode && (
        <span className="inline-flex max-w-[180px] items-center rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <span className="truncate">{formatPermissionMode(permissionMode)}</span>
        </span>
      )}
      {worktreeName && (
        <span
          title={worktreeName}
          className="inline-flex max-w-[180px] items-center rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          <span className="truncate">{worktreeName}</span>
        </span>
      )}
    </div>
  )
}

export const AssistantMessageItem = memo(function AssistantMessageItem({
  message,
  isLastMessage,
  isStreaming,
  status,
  isMobile,
  subChatId,
  chatId,
  sandboxSetupStatus = "ready",
}: AssistantMessageItemProps) {
  const showMessageJson = useAtomValue(showMessageJsonAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectPath = selectedProject?.path
  const onOpenFile = useFileOpen()
  const onFork = useContext(ForkContext)
  const isDev = import.meta.env.DEV
  const reasoningStartedAtRef = useRef(
    getReasoningStartedAt(`${subChatId}:${message.id}`, (message.metadata as any)?.startedAt),
  )
  // Normalize ACP/codex tool parts into canonical types (e.g. "tool-Read README.md" → "tool-Read").
  // Note: no useMemo - AI SDK mutates parts in-place, so the array reference
  // doesn't change and useMemo would return stale results.
  const messageParts = dedupeVisibleReasoningParts(
    normalizeAcpParts(
      (message?.parts || []).map((part: any) => normalizeCodexToolPart(part) as any),
    ),
    isReasoningPart,
  )

  const hasReasoningOutput = messageParts.some(isReasoningPart)
  const shouldShowWorkingTimer =
    sandboxSetupStatus === "ready" && isStreaming && isLastMessage && !hasReasoningOutput

  const {
    nestedToolsMap,
    nestedToolIds,
    orphanTaskGroups,
    orphanToolCallIds,
    orphanFirstToolCallIds,
  } = useMemo(() => {
    const nestedToolsMap = new Map<string, any[]>()
    const nestedToolIds = new Set<string>()
    const taskPartIds = new Set(
      messageParts
        .filter((p: any) => p.type === "tool-Task" && p.toolCallId)
        .map((p: any) => p.toolCallId),
    )
    const orphanTaskGroups = new Map<string, { parts: any[]; firstToolCallId: string }>()
    const orphanToolCallIds = new Set<string>()
    const orphanFirstToolCallIds = new Set<string>()

    for (const part of messageParts) {
      if (part.toolCallId?.includes(":")) {
        const parentId = part.toolCallId.split(":")[0]
        if (taskPartIds.has(parentId)) {
          if (!nestedToolsMap.has(parentId)) {
            nestedToolsMap.set(parentId, [])
          }
          nestedToolsMap.get(parentId)!.push(part)
          nestedToolIds.add(part.toolCallId)
        } else {
          let group = orphanTaskGroups.get(parentId)
          if (!group) {
            group = { parts: [], firstToolCallId: part.toolCallId }
            orphanTaskGroups.set(parentId, group)
            orphanFirstToolCallIds.add(part.toolCallId)
          }
          group.parts.push(part)
          orphanToolCallIds.add(part.toolCallId)
        }
      }
    }

    return {
      nestedToolsMap,
      nestedToolIds,
      orphanTaskGroups,
      orphanToolCallIds,
      orphanFirstToolCallIds,
    }
  }, [messageParts])

  // Collect all plan operations (Write/Edit) for unified handling
  const planOpsSummary = useMemo(() => {
    const operations: Array<{ type: "write" | "edit"; part: any; index: number }> = []

    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i]
      const filePath = part.input?.file_path || ""

      if ((part.type === "tool-Write" || part.type === "tool-Edit") && isPlanFile(filePath)) {
        operations.push({
          type: part.type === "tool-Write" ? "write" : "edit",
          part,
          index: i,
        })
      }
    }

    if (operations.length === 0) {
      return {
        operations: [],
        hasAnyPlanOperation: false,
        isStreaming: false,
        lastOperationType: null as "write" | "edit" | null,
      }
    }

    const isStreaming = operations.some(
      (op) => op.part.state === "input-streaming" || op.part.state === "pending",
    )

    const lastOp = operations[operations.length - 1]

    return {
      operations,
      hasAnyPlanOperation: true,
      isStreaming,
      lastOperationType: lastOp.type,
    }
  }, [messageParts])

  // Keep one Codex-style run disclosure. Provider summaries can arrive after the
  // final answer, so select the final text explicitly instead of relying on order.
  const { shouldCollapse, hasActivity, visibleStepsCount, collapseBeforeIndex } = useMemo(() => {
    let lastTextIndex = -1
    let hasActivity = false

    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i]
      if (part.type?.startsWith("tool-") || isReasoningPart(part)) hasActivity = true
      if (part.type === "text" && part.text?.trim()) {
        lastTextIndex = i
      }
    }

    const hasFinalText = hasActivity && lastTextIndex !== -1 && (!isStreaming || !isLastMessage)

    // Collapse only when there's final text after tools
    const shouldCollapse = hasFinalText
    const collapseBeforeIndex = hasFinalText ? lastTextIndex : -1

    // Calculate visible steps count for collapsible header
    const stepParts =
      shouldCollapse && collapseBeforeIndex !== -1
        ? messageParts.filter((_: any, index: number) => index !== collapseBeforeIndex)
        : messageParts
    const visibleStepsCount = stepParts.filter((p: any) => {
      if (p.type === "step-start") return false
      if (p.type === "tool-TaskOutput") return false
      if (p.type === "tool-ExitPlanMode") return false
      if (isReasoningPart(p) && !getReasoningOutputText(p).trim()) return false
      if (p.toolCallId && nestedToolIds.has(p.toolCallId)) return false
      if (
        p.toolCallId &&
        orphanToolCallIds.has(p.toolCallId) &&
        !orphanFirstToolCallIds.has(p.toolCallId)
      )
        return false
      if (p.type === "text" && !p.text?.trim()) return false
      return true
    }).length

    return { shouldCollapse, hasActivity, visibleStepsCount, collapseBeforeIndex }
  }, [
    messageParts,
    isStreaming,
    isLastMessage,
    nestedToolIds,
    orphanToolCallIds,
    orphanFirstToolCallIds,
  ])

  // Check if any plan operation is in collapsed steps (before collapseBeforeIndex)
  const hasPlanInCollapsedSteps = useMemo(() => {
    if (!shouldCollapse || collapseBeforeIndex === -1) return false
    return planOpsSummary.operations.some((op) => op.index < collapseBeforeIndex)
  }, [shouldCollapse, collapseBeforeIndex, planOpsSummary.operations])

  // Get the last plan operation from collapsed steps for showing card
  const lastCollapsedPlanOp = useMemo(() => {
    if (!hasPlanInCollapsedSteps) return null
    const collapsedOps = planOpsSummary.operations.filter((op) => op.index < collapseBeforeIndex)
    return collapsedOps[collapsedOps.length - 1] || null
  }, [hasPlanInCollapsedSteps, planOpsSummary.operations, collapseBeforeIndex])

  const stepParts = useMemo(() => {
    if (!hasActivity) return []
    if (!shouldCollapse || collapseBeforeIndex === -1) return messageParts
    return messageParts.filter((_: any, index: number) => index !== collapseBeforeIndex)
  }, [messageParts, hasActivity, shouldCollapse, collapseBeforeIndex])

  const finalParts = useMemo(() => {
    if (!hasActivity) return messageParts
    if (!shouldCollapse || collapseBeforeIndex === -1) return []
    return [messageParts[collapseBeforeIndex]]
  }, [messageParts, hasActivity, shouldCollapse, collapseBeforeIndex])

  const hasTextContent = useMemo(
    () => messageParts.some((p: any) => p.type === "text" && p.text?.trim()),
    [messageParts],
  )

  const msgMetadata = message?.metadata as AgentMessageMetadata
  const timestamp = formatMessageTimestamp(message)

  const renderPart = useCallback(
    (part: any, idx: number, isFinal = false) => {
      if (part.type === "step-start") return null
      if (part.type === "tool-TaskOutput") return null

      if (part.toolCallId && orphanToolCallIds.has(part.toolCallId)) {
        if (!orphanFirstToolCallIds.has(part.toolCallId)) return null
        const parentId = part.toolCallId.split(":")[0]
        const group = orphanTaskGroups.get(parentId)
        if (group) {
          return (
            <AgentTaskTool
              key={idx}
              part={{
                type: "tool-Task",
                toolCallId: parentId,
                input: { subagent_type: "unknown-agent", description: "Incomplete task" },
              }}
              nestedTools={group.parts}
              chatStatus={status}
            />
          )
        }
      }

      if (part.toolCallId && nestedToolIds.has(part.toolCallId)) return null
      if (part.type === "exploring-group") return null

      if (part.type === "text") {
        if (!part.text?.trim()) return null
        const isFinalText = isFinal && idx === collapseBeforeIndex
        const isTextStreaming = isLastMessage && isStreaming
        return (
          <MemoizedTextPart
            key={idx}
            text={part.text}
            messageId={message.id}
            partIndex={idx}
            isFinalText={isFinalText}
            visibleStepsCount={visibleStepsCount}
            isStreaming={isTextStreaming}
          />
        )
      }

      if (part.type === "tool-Task") {
        const nestedTools = nestedToolsMap.get(part.toolCallId) || []
        return <AgentTaskTool key={idx} part={part} nestedTools={nestedTools} chatStatus={status} />
      }

      if (part.type === "tool-Bash")
        return (
          <AgentBashTool
            key={idx}
            part={part}
            messageId={message.id}
            partIndex={idx}
            chatStatus={status}
          />
        )
      if (isReasoningPart(part)) {
        return (
          <AgentReasoningOutput
            key={idx}
            part={toReasoningOutputPart(part, message?.id, idx)}
            chatStatus={status}
            durationMs={msgMetadata?.durationMs}
            startedAt={reasoningStartedAtRef.current}
            hideHeader
          />
        )
      }

      // Plan files: unified handling
      // - In collapsed steps: all show mini indicator, last collapsed op's card shown separately after finalParts
      // - In final parts: all but last show mini indicator, last shows full card
      if (part.type === "tool-Write" || part.type === "tool-Edit") {
        const filePath = part.input?.file_path || ""
        if (isPlanFile(filePath)) {
          // Use part.toolCallId to find operation since idx may be adjusted for collapsed parts
          const opIndex = planOpsSummary.operations.findIndex(
            (op) => op.part.toolCallId === part.toolCallId,
          )
          if (opIndex === -1) return null

          const originalIndex = planOpsSummary.operations[opIndex]?.index ?? -1
          const isInCollapsedSteps =
            shouldCollapse && collapseBeforeIndex !== -1 && originalIndex < collapseBeforeIndex
          const isLastCollapsedOp = lastCollapsedPlanOp?.part.toolCallId === part.toolCallId
          const isLastOperation = opIndex === planOpsSummary.operations.length - 1

          // If this is the last collapsed plan op, hide it here (card shown after CollapsibleSteps)
          if (isInCollapsedSteps && isLastCollapsedOp) {
            return null
          }

          // Show mini indicator for:
          // - All operations in collapsed steps (except last collapsed, handled above)
          // - All operations except last in final parts
          const showMiniIndicator = isInCollapsedSteps || !isLastOperation

          if (showMiniIndicator) {
            const isWrite = part.type === "tool-Write"
            const { isPending } = getToolStatus(part, status)
            const isOpStreaming =
              isPending || (part.state === "input-streaming" && isStreaming && isLastMessage)

            return (
              <div key={idx} className="flex items-center gap-1.5 px-2 py-0.5">
                <span className="text-xs text-muted-foreground">
                  {isOpStreaming ? (
                    <TextShimmer as="span" duration={1.2}>
                      {isWrite ? "Creating plan..." : "Updating plan..."}
                    </TextShimmer>
                  ) : isWrite ? (
                    "Created plan"
                  ) : (
                    "Updated plan"
                  )}
                </span>
              </div>
            )
          }

          // Last operation in final parts: show full card
          return (
            <AgentPlanFileTool
              key={idx}
              part={part}
              chatStatus={status}
              subChatId={subChatId}
              isEdit={part.type === "tool-Edit"}
            />
          )
        }
      }

      if (part.type === "tool-Edit") if (msgMetadata?.runId && !isStreaming) return null
      if (part.type === "tool-Edit")
        return (
          <AgentEditTool
            key={idx}
            part={part}
            messageId={message.id}
            partIndex={idx}
            chatStatus={status}
          />
        )
      if (part.type === "tool-Write") if (msgMetadata?.runId && !isStreaming) return null
      if (part.type === "tool-Write")
        return (
          <AgentEditTool
            key={idx}
            part={part}
            messageId={message.id}
            partIndex={idx}
            chatStatus={status}
          />
        )
      if (part.type === "tool-WebSearch")
        return <AgentWebSearchCollapsible key={idx} part={part} chatStatus={status} />
      if (part.type === "tool-WebFetch")
        return <AgentWebFetchTool key={idx} part={part} chatStatus={status} />
      if (part.type === "tool-PlanWrite")
        return <AgentPlanTool key={idx} part={part} chatStatus={status} />

      // ExitPlanMode tool is hidden - plan is shown in sidebar instead
      if (part.type === "tool-ExitPlanMode") {
        return null
      }

      if (part.type === "tool-TodoWrite") {
        return <AgentTodoTool key={idx} part={part} chatStatus={status} subChatId={subChatId} />
      }

      if (part.type === "tool-AskUserQuestion") {
        const { isPending, isError } = getToolStatus(part, status)
        return (
          <AgentAskUserQuestionTool
            key={idx}
            input={part.input}
            result={part.result}
            errorText={(part as any).errorText || (part as any).error}
            state={isPending ? "call" : "result"}
            isError={isError}
            isStreaming={isStreaming && isLastMessage}
            toolCallId={part.toolCallId}
          />
        )
      }

      if (part.type in AgentToolRegistry) {
        const meta = AgentToolRegistry[part.type]
        const { isPending, isError } = getToolStatus(part, status)
        // Make Read tool clickable to open file in viewer
        const handleClick =
          part.type === "tool-Read" && onOpenFile && part.input?.file_path
            ? () => onOpenFile(part.input.file_path)
            : undefined
        return (
          <AgentToolCall
            key={idx}
            icon={meta.icon}
            title={meta.title(part)}
            subtitle={meta.subtitle?.(part)}
            tooltipContent={meta.tooltipContent?.(part, projectPath)}
            isPending={isPending}
            isError={isError}
            onClick={handleClick}
          />
        )
      }

      // MCP tool calls (pattern: tool-mcp__<server>__<tool>)
      const mcpInfo = parseMcpToolType(part.type)
      if (mcpInfo) {
        return <AgentMcpToolCall key={idx} part={part} mcpInfo={mcpInfo} chatStatus={status} />
      }

      if (part.type?.startsWith("tool-")) {
        return (
          <div key={idx} className="text-xs text-muted-foreground py-0.5 px-2">
            {part.type.replace("tool-", "")}
          </div>
        )
      }

      return null
    },
    [
      nestedToolsMap,
      nestedToolIds,
      orphanToolCallIds,
      orphanFirstToolCallIds,
      orphanTaskGroups,
      collapseBeforeIndex,
      visibleStepsCount,
      status,
      isLastMessage,
      isStreaming,
      subChatId,
      message.id,
      msgMetadata?.durationMs,
      planOpsSummary,
      shouldCollapse,
      lastCollapsedPlanOp,
    ],
  )

  if (!message) return null

  return (
    <div data-assistant-message-id={message.id} className="group/message w-full mb-4">
      <ProducerChips metadata={msgMetadata} />
      <div className="flex flex-col gap-1.5">
        {hasActivity && visibleStepsCount > 0 && (
          <ReasoningTimeline
            isStreaming={isStreaming && isLastMessage}
            durationMs={msgMetadata?.durationMs}
            startedAt={reasoningStartedAtRef.current}
          >
            {(() => {
              const activityGrouped = groupToolActivities(stepParts, nestedToolIds)
              const taskGrouped = groupTaskTools(activityGrouped, nestedToolIds)
              const grouped = groupExploringTools(taskGrouped, nestedToolIds)
              return grouped.map((part: any, idx: number) => {
                if (part.type === "activity-group") {
                  return (
                    <ToolActivityGroup
                      key={idx}
                      parts={part.parts}
                      isStreaming={isStreaming && isLastMessage}
                    >
                      {part.parts.map((toolPart: any, toolIdx: number) =>
                        renderPart(toolPart, idx * 1000 + toolIdx, false),
                      )}
                    </ToolActivityGroup>
                  )
                }
                if (part.type === "exploring-group") {
                  const isLast = idx === grouped.length - 1
                  const isGroupStreaming = isStreaming && isLastMessage && isLast
                  return (
                    <AgentExploringGroup
                      key={idx}
                      parts={part.parts}
                      chatStatus={status}
                      isStreaming={isGroupStreaming}
                    />
                  )
                }
                if (part.type === "task-group") {
                  const isLast = idx === grouped.length - 1
                  const isGroupStreaming = isStreaming && isLastMessage && isLast
                  return (
                    <AgentTaskToolsGroup
                      key={idx}
                      parts={part.parts}
                      chatStatus={status}
                      isStreaming={isGroupStreaming}
                      subChatId={subChatId}
                    />
                  )
                }
                return renderPart(part, idx, false)
              })
            })()}
          </ReasoningTimeline>
        )}
        {!isStreaming && <AgentChangedFilesCard runId={msgMetadata?.runId} />}

        {(() => {
          // Apply both grouping functions: first task tools, then exploring tools
          const taskGrouped = groupTaskTools(finalParts, nestedToolIds)
          const grouped = groupExploringTools(taskGrouped, nestedToolIds)
          return grouped.map((part: any, idx: number) => {
            if (part.type === "exploring-group") {
              const isLast = idx === grouped.length - 1
              const isGroupStreaming = isStreaming && isLastMessage && isLast
              return (
                <AgentExploringGroup
                  key={idx}
                  parts={part.parts}
                  chatStatus={status}
                  isStreaming={isGroupStreaming}
                />
              )
            }
            if (part.type === "task-group") {
              const isLast = idx === grouped.length - 1
              const isGroupStreaming = isStreaming && isLastMessage && isLast
              return (
                <AgentTaskToolsGroup
                  key={idx}
                  parts={part.parts}
                  chatStatus={status}
                  isStreaming={isGroupStreaming}
                  subChatId={subChatId}
                />
              )
            }
            return renderPart(
              part,
              shouldCollapse ? collapseBeforeIndex + idx : idx,
              shouldCollapse,
            )
          })
        })()}

        {/* Show plan card after finalParts if any plan operation was in collapsed steps */}
        {shouldCollapse && lastCollapsedPlanOp && (
          <AgentPlanFileTool
            part={lastCollapsedPlanOp.part}
            chatStatus={status}
            subChatId={subChatId}
            isEdit={lastCollapsedPlanOp.type === "edit"}
          />
        )}

        {shouldShowWorkingTimer && visibleStepsCount === 0 && (
          <AgentReasoningOutput
            part={{
              type: "tool-ReasoningOutput",
              state: "input-streaming",
              input: { text: "" },
            }}
            chatStatus={status}
            startedAt={reasoningStartedAtRef.current}
          />
        )}
      </div>

      {hasTextContent && (!isStreaming || !isLastMessage) && (
        <div className="flex justify-between items-center h-6 px-2 mt-1">
          <div className="flex items-center gap-0.5">
            <CopyButton text={getMessageTextContent(message)} isMobile={isMobile} />
            <PlayButton
              text={getMessageTextContent(message)}
              isMobile={isMobile}
              chatId={chatId}
              subChatId={subChatId}
              messageId={message.id}
              highlightColor={
                getHarnessChipMeta(
                  (msgMetadata as AgentMessageMetadata & { harness?: string })?.harness,
                ).color
              }
            />
            {timestamp && (
              <span className="ml-1 text-[10px] text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <AgentMessageUsage
              metadata={msgMetadata}
              isStreaming={isStreaming}
              isMobile={isMobile}
            />
            {onFork && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    tabIndex={-1}
                    className="p-1 rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem onClick={() => onFork(message.id)}>
                    Fork from here
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* Git activity badges - commit/PR pills */}
      {(!isStreaming || !isLastMessage) && (
        <GitActivityBadges parts={messageParts} chatId={chatId} subChatId={subChatId} />
      )}

      {isDev && showMessageJson && (
        <div className="px-2 mt-2">
          <MessageJsonDisplay message={message} label="Assistant" />
        </div>
      )}
    </div>
  )
}, areMessagePropsEqual)
