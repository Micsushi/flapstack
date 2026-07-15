"use client"

import { useMemo, useState } from "react"
import { CirclePause, CirclePlay, GitFork, Plus, RefreshCw, Replace, Square } from "lucide-react"
import { toast } from "sonner"
import type {
  OrchestrationAgentDefinition,
  OrchestrationAgentDto,
  OrchestrationControlAction,
  OrchestrationLineageDto,
  OrchestrationStopConditions,
  OrchestrationTaskOverviewDto,
} from "../../../../shared/agent-orchestration"
import type { CoordinationEngine } from "../../../../shared/coordination-engine"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
} from "../../../../shared/permission-capabilities"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { Input } from "../../../components/ui/input"
import { Textarea } from "../../../components/ui/textarea"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { CoordinationEngineLaunchPreviewPanel } from "./coordination-engine-launch-preview"
import { OrchestrationLineageTree } from "./orchestration-lineage-tree"
import { OrchestrationActivityPanel } from "./orchestration-activity-panel"

type AgentEditorMode =
  | { kind: "create-orchestration"; createTask: boolean }
  | { kind: "add" }
  | { kind: "replace"; agent: OrchestrationAgentDto }

const emptyDefinition: OrchestrationAgentDefinition = {
  role: "Worker",
  prompt: "",
  harness: "codex",
  permissionMode: "ask-before-edits",
  worktreeStrategy: "inherit",
  dependencyAgentIds: [],
  completionCriteria: "Complete the assigned work and report verification evidence.",
}

const CUSTOM_PERMISSION_LABELS: Record<(typeof customPermissionCapabilityKeys)[number], string> = {
  projectWrite: "Project edits",
  shell: "Shell",
  network: "Network",
  git: "Git",
  browser: "Browser",
  secrets: "Secrets",
  subagents: "Subagents",
  thirdPartyMcp: "Third-party MCP",
  productMcpRead: "Product MCP reads",
  productMcpWrite: "Product MCP writes",
  productMcpTier3: "Product MCP Tier 3",
}

export function applyOrchestrationPermissionMode(
  definition: OrchestrationAgentDefinition,
  permissionMode: OrchestrationAgentDefinition["permissionMode"],
): OrchestrationAgentDefinition {
  return {
    ...definition,
    permissionMode,
    customPermissions:
      permissionMode === "custom"
        ? (definition.customPermissions ?? { ...disabledCustomPermissions })
        : undefined,
  }
}

export function formatOrchestrationCost(
  exactUsdMicros: number,
  providerReportedUsdMicros: number,
  estimatedUsdMicros: number,
  quality: OrchestrationTaskOverviewDto["aggregate"]["costQuality"],
): string | null {
  if (
    quality === "unknown" &&
    exactUsdMicros === 0 &&
    providerReportedUsdMicros === 0 &&
    estimatedUsdMicros === 0
  )
    return null
  const parts: string[] = []
  if (exactUsdMicros > 0) {
    parts.push(`$${(exactUsdMicros / 1_000_000).toFixed(2)} exact`)
  }
  if (providerReportedUsdMicros > 0) {
    parts.push(`$${(providerReportedUsdMicros / 1_000_000).toFixed(2)} reported`)
  }
  if (estimatedUsdMicros > 0) {
    parts.push(`est. $${(estimatedUsdMicros / 1_000_000).toFixed(2)}`)
  }
  return parts.length > 0 ? parts.join(" + ") : "$0.00"
}

export function getLineageNavigation(
  overview: OrchestrationTaskOverviewDto,
  lineage: OrchestrationLineageDto,
  currentChatId: string,
): { parentChatId: string | null; childChats: Array<{ id: string; label: string }> } {
  const byAgent = new Map(overview.agents.map((agent) => [agent.id, agent]))
  const current = overview.agents.find((agent) => agent.chatId === currentChatId)
  const currentAgentId = current?.id ?? null
  const isInitiator = overview.orchestration.initiatingChatId === currentChatId
  const parentAgent = current?.parentAgentId ? byAgent.get(current.parentAgentId) : null
  const parentChatId = current
    ? (parentAgent?.chatId ?? overview.orchestration.initiatingChatId)
    : null
  const children = overview.agents.filter((agent) =>
    isInitiator ? !agent.parentAgentId : agent.parentAgentId === currentAgentId,
  )
  const nodeNames = new Map(lineage.nodes.map((node) => [node.agentId, node.name || node.role]))
  return {
    parentChatId,
    childChats: children.flatMap((agent) =>
      agent.chatId
        ? [
            {
              id: agent.chatId,
              label: nodeNames.get(agent.id) ?? agent.definition.name ?? agent.definition.role,
            },
          ]
        : [],
    ),
  }
}

type ChatLineagePreview = {
  parent: { id: string; name: string | null; archived: boolean } | null
  children: Array<{ id: string; name: string | null; archived: boolean }>
  status: "ok" | "stale"
}

export function ChatForkLineageLinks({
  lineage,
  onNavigate,
}: {
  lineage: ChatLineagePreview
  onNavigate: (chatId: string) => void
}) {
  if (lineage.status !== "ok" || (!lineage.parent && lineage.children.length === 0)) return null
  return (
    <nav aria-label="Agent chat lineage" className="mb-3 rounded-md border border-border/60 p-2">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <GitFork aria-hidden="true" className="h-3 w-3 text-violet-400" /> Agent forks
      </div>
      <div className="flex flex-wrap gap-1">
        {lineage.parent && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 max-w-full px-2 text-[10px]"
            disabled={lineage.parent.archived}
            onClick={() => onNavigate(lineage.parent!.id)}
            aria-label={`Open parent agent chat ${lineage.parent.name ?? "Untitled chat"}`}
          >
            <GitFork className="mr-1 h-3 w-3 rotate-180" />
            <span className="truncate">Parent: {lineage.parent.name ?? "Untitled"}</span>
          </Button>
        )}
        {lineage.children.map((child) => (
          <Button
            key={child.id}
            variant="outline"
            size="sm"
            className="h-6 max-w-full px-2 text-[10px]"
            disabled={child.archived}
            onClick={() => onNavigate(child.id)}
            aria-label={`Open child agent chat ${child.name ?? "Untitled chat"}`}
          >
            <GitFork className="mr-1 h-3 w-3" />
            <span className="truncate">{child.name ?? "Untitled"}</span>
          </Button>
        ))}
      </div>
    </nav>
  )
}

function statusClass(status: string) {
  if (status === "completed") return "text-emerald-400 bg-emerald-500/10"
  if (status === "failed") return "text-red-400 bg-red-500/10"
  if (status === "active" || status === "running") return "text-sky-400 bg-sky-500/10"
  if (status === "paused") return "text-amber-400 bg-amber-500/10"
  return "text-muted-foreground bg-muted/50"
}

function stopConditionSummary(conditions: OrchestrationStopConditions): string[] {
  return [
    conditions.targetCompletedAgents && `${conditions.targetCompletedAgents} completed agents`,
    conditions.targetProgressPercent && `${conditions.targetProgressPercent}% progress`,
    conditions.maxWallClockMs && `${Math.ceil(conditions.maxWallClockMs / 60_000)} min`,
    conditions.maxTotalTokens && `${conditions.maxTotalTokens.toLocaleString()} tokens`,
    conditions.maxCostUsdMicros && `$${(conditions.maxCostUsdMicros / 1_000_000).toFixed(2)} cost`,
    conditions.maxFailures && `${conditions.maxFailures} failures`,
    conditions.maxBlockers && `${conditions.maxBlockers} blockers`,
  ].filter((value): value is string => Boolean(value))
}

export function OrchestrationOverviewCard({
  overview,
  lineage,
  currentChatId,
  busy = false,
  onNavigate,
  onControl,
  onRetry,
  onReplace,
  onAdd,
}: {
  overview: OrchestrationTaskOverviewDto
  lineage: OrchestrationLineageDto
  currentChatId: string
  busy?: boolean
  onNavigate: (chatId: string) => void
  onControl: (action: OrchestrationControlAction) => void
  onRetry: (agent: OrchestrationAgentDto) => void
  onReplace: (agent: OrchestrationAgentDto) => void
  onAdd: () => void
}) {
  const { orchestration, aggregate, agents } = overview
  const cost = formatOrchestrationCost(
    aggregate.exactCostUsdMicros,
    aggregate.providerReportedCostUsdMicros,
    aggregate.estimatedCostUsdMicros,
    aggregate.costQuality,
  )
  const canPause = orchestration.status === "running"
  const canResume = orchestration.status === "paused"
  const canStop = ["queued", "running", "paused"].includes(orchestration.status)
  const stopConditions = stopConditionSummary(orchestration.stopConditions)

  return (
    <section
      aria-label={`Agent orchestration ${orchestration.name}`}
      className="p-3 space-y-3"
      data-orchestration-task-id={orchestration.taskId}
      data-orchestration-chat-id={currentChatId}
      data-orchestration-status={orchestration.status}
      data-orchestration-cost-quality={aggregate.costQuality}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <GitFork aria-hidden="true" className="h-3.5 w-3.5 text-violet-400" />
            <h3 className="truncate text-xs font-semibold">{orchestration.name}</h3>
            <span
              className={cn("rounded px-1.5 py-0.5 text-[10px]", statusClass(orchestration.status))}
            >
              {orchestration.status}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {aggregate.progressPercent}% · {aggregate.active} active · {aggregate.queued} queued ·{" "}
            {aggregate.completed} done · {aggregate.failed} failed · {aggregate.blocked} blocked ·{" "}
            {aggregate.stopped} stopped
          </p>
        </div>
        <div className="flex items-center gap-1">
          {canPause && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={busy}
              onClick={() => onControl("pause")}
              aria-label="Pause orchestration"
            >
              <CirclePause className="h-3.5 w-3.5" />
            </Button>
          )}
          {canResume && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={busy}
              onClick={() => onControl("resume")}
              aria-label="Resume orchestration"
            >
              <CirclePlay className="h-3.5 w-3.5" />
            </Button>
          )}
          {canStop && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-400"
              disabled={busy}
              onClick={() => onControl("stop")}
              aria-label="Stop orchestration"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={busy}
            onClick={onAdd}
            aria-label="Add orchestration agent"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        aria-label="Orchestration progress"
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-violet-500 transition-[width]"
          style={{ width: `${aggregate.progressPercent}%` }}
        />
      </div>

      <dl className="grid grid-cols-4 gap-2 text-[10px]">
        <div>
          <dt className="text-muted-foreground">Agents</dt>
          <dd>{aggregate.total}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Parallel</dt>
          <dd>
            {aggregate.active}/{orchestration.maxParallelAgents}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tokens</dt>
          <dd>{aggregate.totalTokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cost</dt>
          <dd>{cost ?? "Unavailable"}</dd>
        </div>
      </dl>

      {stopConditions.length > 0 && (
        <p className="text-[10px] text-muted-foreground">Stop at {stopConditions.join(" · ")}</p>
      )}

      <OrchestrationLineageTree
        lineage={lineage}
        onNavigate={onNavigate}
        currentChatId={currentChatId}
      />

      <OrchestrationActivityPanel taskId={orchestration.taskId} agents={agents} />

      <ul aria-label="Orchestration agents" className="space-y-1.5">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="rounded-md border border-border/60 p-2 text-[11px]"
            data-orchestration-agent-id={agent.id}
            data-orchestration-agent-status={agent.status}
          >
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-medium">
                {agent.definition.name ?? agent.definition.role}
              </span>
              <span className={cn("rounded px-1.5 py-0.5 text-[9px]", statusClass(agent.status))}>
                {agent.status}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
              <span>{agent.definition.harness}</span>
              {agent.definition.model && <span>{agent.definition.model}</span>}
              <span>{agent.progressPercent}%</span>
              {agent.definition.dependencyAgentIds.length > 0 && (
                <span>{agent.definition.dependencyAgentIds.length} dependencies</span>
              )}
              {agent.blockerCount > 0 && <span>{agent.blockerCount} blockers</span>}
            </div>
            <code className="mt-1 block select-all break-all text-[9px] text-muted-foreground">
              {agent.id}
            </code>
            {agent.resultSummary && (
              <p className="mt-1 line-clamp-2 text-[10px]">{agent.resultSummary}</p>
            )}
            {agent.stopReason && (
              <p className="mt-1 line-clamp-2 text-[10px] text-amber-400">{agent.stopReason}</p>
            )}
            <div className="mt-1.5 flex gap-1">
              {agent.chatId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[9px]"
                  onClick={() => onNavigate(agent.chatId!)}
                  aria-label={`Open agent chat ${agent.definition.name ?? agent.definition.role}`}
                >
                  Open chat
                </Button>
              )}
              {(agent.status === "failed" || agent.status === "stopped") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[9px]"
                  disabled={busy}
                  onClick={() => onRetry(agent)}
                  aria-label={`Retry agent ${agent.definition.name ?? agent.definition.role}`}
                >
                  <RefreshCw className="mr-1 h-3 w-3" /> Retry
                </Button>
              )}
              {agent.status !== "completed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[9px]"
                  disabled={busy}
                  onClick={() => onReplace(agent)}
                  aria-label={`Replace agent ${agent.definition.name ?? agent.definition.role}`}
                >
                  <Replace className="mr-1 h-3 w-3" /> Replace
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {orchestration.stopReason && (
        <p role="status" className="rounded-md bg-amber-500/10 p-2 text-[10px] text-amber-300">
          Stopped: {orchestration.stopReason}
        </p>
      )}
    </section>
  )
}

function StopNumberField({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string
  value: string
  max?: number
  step?: number
  onChange: (value: string) => void
}) {
  return (
    <label className="text-[11px]">
      {label}
      <Input
        className="mt-1"
        type="number"
        min={step ?? 1}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function AgentEditorDialog({
  mode,
  projectId,
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  mode: AgentEditorMode
  projectId: string
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (
    definition: OrchestrationAgentDefinition,
    maxParallelAgents: number,
    taskName: string,
    stopConditions: OrchestrationStopConditions,
    coordinationEngine: CoordinationEngine | undefined,
  ) => void
}) {
  const seed = mode.kind === "replace" ? mode.agent.definition : emptyDefinition
  const [definition, setDefinition] = useState<OrchestrationAgentDefinition>(seed)
  const [maxParallelAgents, setMaxParallelAgents] = useState(2)
  const [taskName, setTaskName] = useState("Agent orchestration")
  const [coordinationEngine, setCoordinationEngine] = useState<CoordinationEngine | null>(null)
  const enginePreview = trpc.coordinationEngines.preview.useQuery({
    projectId,
    perLaunchEngine: coordinationEngine,
  })
  const [stopFields, setStopFields] = useState({
    targetCompletedAgents: "",
    targetProgressPercent: "",
    maxWallClockMinutes: "",
    maxTotalTokens: "",
    maxCostUsd: "",
    maxFailures: "",
    maxBlockers: "",
  })
  const title =
    mode.kind === "create-orchestration"
      ? "Start agent orchestration"
      : mode.kind === "replace"
        ? "Replace agent"
        : "Add agent"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Define the worker. Exact, provider-reported, and estimated cost stay labeled separately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {mode.kind === "create-orchestration" && mode.createTask && (
            <label className="text-xs sm:col-span-2">
              Task name
              <Input
                className="mt-1"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
              />
            </label>
          )}
          <label className="text-xs">
            Role
            <Input
              className="mt-1"
              value={definition.role}
              onChange={(event) => setDefinition({ ...definition, role: event.target.value })}
            />
          </label>
          <label className="text-xs">
            Name
            <Input
              className="mt-1"
              value={definition.name ?? ""}
              onChange={(event) =>
                setDefinition({ ...definition, name: event.target.value || undefined })
              }
            />
          </label>
          <label className="text-xs">
            Harness
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.harness}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  harness: event.target.value as OrchestrationAgentDefinition["harness"],
                  provider: undefined,
                })
              }
            >
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
            </select>
          </label>
          <label className="text-xs">
            Runtime preference
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.runtimePreference ?? "auto"}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  runtimePreference: event.target.value as NonNullable<
                    OrchestrationAgentDefinition["runtimePreference"]
                  >,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
              <option value="flapstack-native">Flapstack native</option>
            </select>
          </label>
          <label className="text-xs">
            Model
            <Input
              className="mt-1"
              value={definition.model ?? ""}
              onChange={(event) =>
                setDefinition({ ...definition, model: event.target.value || undefined })
              }
            />
          </label>
          <label className="text-xs">
            Provider
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.provider ?? ""}
              onChange={(event) =>
                setDefinition({ ...definition, provider: event.target.value || undefined })
              }
            >
              <option value="">Harness default</option>
              {definition.harness === "codex" ? (
                <option value="openai">OpenAI</option>
              ) : (
                <option value="anthropic">Anthropic</option>
              )}
            </select>
          </label>
          <label className="text-xs">
            Reasoning effort
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.reasoningEffort ?? ""}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  reasoningEffort: (event.target.value ||
                    undefined) as OrchestrationAgentDefinition["reasoningEffort"],
                })
              }
            >
              <option value="">Provider default</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
            </select>
          </label>
          <label className="text-xs">
            Permission
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.permissionMode}
              onChange={(event) =>
                setDefinition(
                  applyOrchestrationPermissionMode(
                    definition,
                    event.target.value as OrchestrationAgentDefinition["permissionMode"],
                  ),
                )
              }
            >
              <option value="read-only">Read only</option>
              <option value="ask-before-edits">Ask before edits</option>
              <option value="auto-edit-project-only">Auto edit project</option>
              <option value="full-access">Full access</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {definition.permissionMode === "custom" && definition.customPermissions && (
            <fieldset className="grid gap-2 rounded-lg border border-border/60 p-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-xs font-medium">Custom capabilities</legend>
              {customPermissionCapabilityKeys.map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={definition.customPermissions?.[key] ?? false}
                    onChange={(event) =>
                      setDefinition({
                        ...definition,
                        customPermissions: {
                          ...definition.customPermissions!,
                          [key]: event.target.checked,
                        },
                      })
                    }
                  />
                  {CUSTOM_PERMISSION_LABELS[key]}
                </label>
              ))}
            </fieldset>
          )}
          <label className="text-xs">
            Worktree
            <select
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={definition.worktreeStrategy}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  worktreeStrategy: event.target
                    .value as OrchestrationAgentDefinition["worktreeStrategy"],
                })
              }
            >
              <option value="task-primary">Task primary</option>
              <option value="inherit">Inherit</option>
              <option value="existing">Existing path</option>
              <option value="attached-branch">Attached branch</option>
              <option value="none">None</option>
            </select>
          </label>
          {mode.kind === "create-orchestration" && (
            <CoordinationEngineLaunchPreviewPanel
              preview={enginePreview.data ?? null}
              selection={coordinationEngine}
              onSelectionChange={setCoordinationEngine}
              loading={enginePreview.isLoading}
            />
          )}
          {mode.kind === "create-orchestration" && (
            <label className="text-xs">
              Maximum parallel agents
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={64}
                value={maxParallelAgents}
                onChange={(event) => setMaxParallelAgents(Number(event.target.value))}
              />
            </label>
          )}
          {mode.kind === "create-orchestration" && (
            <fieldset className="grid gap-2 rounded-lg border border-border/60 p-3 sm:col-span-2 sm:grid-cols-3">
              <legend className="px-1 text-xs font-medium">Stop conditions</legend>
              <StopNumberField
                label="Completed agents"
                value={stopFields.targetCompletedAgents}
                onChange={(value) => setStopFields({ ...stopFields, targetCompletedAgents: value })}
              />
              <StopNumberField
                label="Progress %"
                value={stopFields.targetProgressPercent}
                max={100}
                onChange={(value) => setStopFields({ ...stopFields, targetProgressPercent: value })}
              />
              <StopNumberField
                label="Wall clock minutes"
                value={stopFields.maxWallClockMinutes}
                onChange={(value) => setStopFields({ ...stopFields, maxWallClockMinutes: value })}
              />
              <StopNumberField
                label="Token budget"
                value={stopFields.maxTotalTokens}
                onChange={(value) => setStopFields({ ...stopFields, maxTotalTokens: value })}
              />
              <StopNumberField
                label="Cost budget USD"
                value={stopFields.maxCostUsd}
                step={0.01}
                onChange={(value) => setStopFields({ ...stopFields, maxCostUsd: value })}
              />
              <StopNumberField
                label="Failure limit"
                value={stopFields.maxFailures}
                onChange={(value) => setStopFields({ ...stopFields, maxFailures: value })}
              />
              <StopNumberField
                label="Blocker limit"
                value={stopFields.maxBlockers}
                onChange={(value) => setStopFields({ ...stopFields, maxBlockers: value })}
              />
              <p className="text-[10px] text-muted-foreground sm:col-span-3">
                Cost is enforceable only from exact provider values. A cost budget requires a token
                or wall-clock fallback; reported and estimated cost remain labels only.
              </p>
            </fieldset>
          )}
          {definition.worktreeStrategy === "existing" && (
            <label className="text-xs sm:col-span-2">
              Worktree path
              <Input
                className="mt-1"
                value={definition.worktreePath ?? ""}
                onChange={(event) =>
                  setDefinition({ ...definition, worktreePath: event.target.value || undefined })
                }
              />
            </label>
          )}
          {definition.worktreeStrategy === "attached-branch" && (
            <label className="text-xs sm:col-span-2">
              Branch
              <Input
                className="mt-1"
                value={definition.branch ?? ""}
                onChange={(event) =>
                  setDefinition({ ...definition, branch: event.target.value || undefined })
                }
              />
            </label>
          )}
          <label className="text-xs sm:col-span-2">
            Dependencies
            <Input
              className="mt-1"
              placeholder="Agent IDs, comma separated"
              value={definition.dependencyAgentIds.join(", ")}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  dependencyAgentIds: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Prompt / spec
            <Textarea
              className="mt-1 min-h-28"
              value={definition.prompt}
              onChange={(event) => setDefinition({ ...definition, prompt: event.target.value })}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Additional spec
            <Textarea
              className="mt-1"
              value={definition.spec ?? ""}
              onChange={(event) =>
                setDefinition({ ...definition, spec: event.target.value || undefined })
              }
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Completion criteria
            <Textarea
              className="mt-1"
              value={definition.completionCriteria}
              onChange={(event) =>
                setDefinition({ ...definition, completionCriteria: event.target.value })
              }
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !definition.role.trim() ||
              !definition.prompt.trim() ||
              !definition.completionCriteria.trim() ||
              (Boolean(stopFields.maxCostUsd) &&
                !stopFields.maxTotalTokens &&
                !stopFields.maxWallClockMinutes) ||
              (mode.kind === "create-orchestration" &&
                (enginePreview.isLoading || enginePreview.data?.ok === false)) ||
              (mode.kind === "create-orchestration" && mode.createTask && !taskName.trim())
            }
            onClick={() =>
              onSubmit(
                definition,
                maxParallelAgents,
                taskName,
                {
                  ...(stopFields.targetCompletedAgents && {
                    targetCompletedAgents: Number(stopFields.targetCompletedAgents),
                  }),
                  ...(stopFields.targetProgressPercent && {
                    targetProgressPercent: Number(stopFields.targetProgressPercent),
                  }),
                  ...(stopFields.maxWallClockMinutes && {
                    maxWallClockMs: Number(stopFields.maxWallClockMinutes) * 60_000,
                  }),
                  ...(stopFields.maxTotalTokens && {
                    maxTotalTokens: Number(stopFields.maxTotalTokens),
                  }),
                  ...(stopFields.maxCostUsd && {
                    maxCostUsdMicros: Math.round(Number(stopFields.maxCostUsd) * 1_000_000),
                  }),
                  ...(stopFields.maxFailures && {
                    maxFailures: Number(stopFields.maxFailures),
                  }),
                  ...(stopFields.maxBlockers && {
                    maxBlockers: Number(stopFields.maxBlockers),
                  }),
                },
                coordinationEngine ?? undefined,
              )
            }
          >
            {busy ? "Saving…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function OrchestrationTaskCard({
  taskId,
  projectId,
  currentChatId,
  onNavigate,
}: {
  taskId?: string | null
  projectId: string
  currentChatId: string
  onNavigate: (chatId: string) => void
}) {
  const utils = trpc.useUtils()
  const taskQueryId = taskId ?? ""
  const overviewQuery = trpc.spawnedAgents.getTaskOverview.useQuery(
    { taskId: taskQueryId },
    { enabled: Boolean(taskId), refetchInterval: 1_000 },
  )
  const lineageQuery = trpc.spawnedAgents.getLineage.useQuery(
    { taskId: taskQueryId },
    { enabled: Boolean(taskId), refetchInterval: 1_000 },
  )
  const chatLineageQuery = trpc.spawnedAgents.previewLineage.useQuery({ chatId: currentChatId })
  const [editorMode, setEditorMode] = useState<AgentEditorMode | null>(null)
  const invalidate = async () => {
    if (!taskId) return
    await Promise.all([
      utils.spawnedAgents.getTaskOverview.invalidate({ taskId }),
      utils.spawnedAgents.getLineage.invalidate({ taskId }),
      utils.spawnedAgents.previewLineage.invalidate(),
      utils.chats.list.invalidate(),
      utils.chats.get.invalidate({ id: currentChatId }),
      utils.tasks.list.invalidate(),
    ])
  }
  const mutationOptions = {
    onSuccess: invalidate,
    onError: (error: { message: string }) => toast.error(error.message),
  }
  const control = trpc.spawnedAgents.control.useMutation(mutationOptions)
  const retry = trpc.spawnedAgents.retryAgent.useMutation(mutationOptions)
  const replace = trpc.spawnedAgents.replaceAgent.useMutation(mutationOptions)
  const add = trpc.spawnedAgents.addAgent.useMutation(mutationOptions)
  const create = trpc.spawnedAgents.createOrchestration.useMutation(mutationOptions)
  const busy =
    control.isPending || retry.isPending || replace.isPending || add.isPending || create.isPending
  const overview = overviewQuery.data
  const lineage = lineageQuery.data

  const selectedReplacement = useMemo(
    () => (editorMode?.kind === "replace" ? editorMode.agent : null),
    [editorMode],
  )
  const submit = (
    agent: OrchestrationAgentDefinition,
    maxParallelAgents: number,
    taskName: string,
    stopConditions: OrchestrationStopConditions,
    coordinationEngine: CoordinationEngine | undefined,
  ) => {
    if (editorMode?.kind === "create-orchestration") {
      create.mutate(
        {
          projectId,
          task: taskId ? { mode: "existing", taskId } : { mode: "create", name: taskName },
          initiatingChatId: currentChatId,
          maxParallelAgents,
          stopConditions,
          coordinationEngine,
          agents: [agent],
        },
        {
          onSuccess: async () => {
            setEditorMode(null)
            await Promise.all([
              utils.tasks.list.invalidate(),
              utils.chats.list.invalidate(),
              utils.chats.get.invalidate({ id: currentChatId }),
              utils.spawnedAgents.previewLineage.invalidate(),
              utils.savedWorkspaces.list.invalidate(),
            ])
          },
        },
      )
    } else if (selectedReplacement) {
      if (taskId)
        replace.mutate(
          { taskId, agentId: selectedReplacement.id, agent },
          { onSuccess: () => setEditorMode(null) },
        )
    } else {
      if (taskId) add.mutate({ taskId, agent }, { onSuccess: () => setEditorMode(null) })
    }
  }

  if (taskId && (overviewQuery.isLoading || lineageQuery.isLoading))
    return <div className="p-3 text-[11px] text-muted-foreground">Loading orchestration…</div>
  if (!overview) {
    return (
      <div className="p-3">
        {chatLineageQuery.data && (
          <ChatForkLineageLinks lineage={chatLineageQuery.data} onNavigate={onNavigate} />
        )}
        <p className="text-[11px] text-muted-foreground">
          {taskId
            ? "Coordinate multiple agents inside this task with durable limits and lineage."
            : "Create one task for this chat and coordinate agents with durable limits and lineage."}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 text-xs"
          onClick={() =>
            setEditorMode({ kind: "create-orchestration", createTask: !Boolean(taskId) })
          }
        >
          <GitFork className="mr-1.5 h-3.5 w-3.5" /> Start orchestration
        </Button>
        {editorMode && (
          <AgentEditorDialog
            key={editorMode.kind}
            mode={editorMode}
            projectId={projectId}
            open
            busy={busy}
            onOpenChange={(open) => !open && setEditorMode(null)}
            onSubmit={submit}
          />
        )}
      </div>
    )
  }
  if (!lineage) return <div className="p-3 text-[11px] text-red-400">Lineage unavailable.</div>

  return (
    <>
      <OrchestrationOverviewCard
        overview={overview}
        lineage={lineage}
        currentChatId={currentChatId}
        busy={busy}
        onNavigate={onNavigate}
        onControl={(action) => control.mutate({ taskId: taskQueryId, action })}
        onRetry={(agent) => retry.mutate({ taskId: taskQueryId, agentId: agent.id })}
        onReplace={(agent) => setEditorMode({ kind: "replace", agent })}
        onAdd={() => setEditorMode({ kind: "add" })}
      />
      {editorMode && (
        <AgentEditorDialog
          key={`${editorMode.kind}-${selectedReplacement?.id ?? "new"}`}
          mode={editorMode}
          projectId={projectId}
          open
          busy={busy}
          onOpenChange={(open) => !open && setEditorMode(null)}
          onSubmit={submit}
        />
      )}
    </>
  )
}
