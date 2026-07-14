import {
  DEFAULT_AUTOMATION_BUDGET,
  DEFAULT_AUTOMATION_RETRY_POLICY,
  type AutomationDraft,
} from "../../../shared/automation"
import type {
  AutomationControlRecord,
  AutomationImpact,
} from "../../../main/lib/automation/control-service"

export const AUTOMATION_A11Y = {
  pageTitle: "Local automations",
  search: "Search local automations",
  list: "Local automation list",
  editor: "Automation editor",
  mutationPreview: "Exact mutation preview",
  history: "Automation execution history",
  inbox: "Automation inbox",
  unreadFilter: "Show unread automation inbox items only",
} as const

export type AutomationUiState = {
  status: "idle" | "saving" | "success" | "error"
  message: string | null
  pendingMutation: AutomationMutationPreview | null
}

export type AutomationUiEvent =
  | { type: "preview"; preview: AutomationMutationPreview }
  | { type: "cancel-preview" }
  | { type: "submit" }
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "clear-message" }

export type AutomationMutationPreview = {
  action: string
  consequence: string
  requiresApproval: boolean
  rows: Array<{ field: string; before: string; after: string }>
}

export const initialAutomationUiState: AutomationUiState = {
  status: "idle",
  message: null,
  pendingMutation: null,
}

export function automationUiReducer(
  state: AutomationUiState,
  event: AutomationUiEvent,
): AutomationUiState {
  switch (event.type) {
    case "preview":
      return { ...state, status: "idle", message: null, pendingMutation: event.preview }
    case "cancel-preview":
      return { ...state, status: "idle", pendingMutation: null }
    case "submit":
      return { ...state, status: "saving", message: null }
    case "success":
      return { status: "success", message: event.message, pendingMutation: null }
    case "error":
      return { ...state, status: "error", message: event.message, pendingMutation: null }
    case "clear-message":
      return { ...state, status: "idle", message: null }
  }
}

export function createDefaultAutomationDraft(): AutomationDraft {
  return {
    name: "",
    description: null,
    scope: { type: "global" },
    action: { type: "create-chat-run" },
    trigger: { type: "manual" },
    run: {
      prompt: "",
      harness: "codex",
      permissionMode: "ask-before-edits",
      worktreeStrategy: "inherit",
    },
    retry: { ...DEFAULT_AUTOMATION_RETRY_POLICY },
    budget: { ...DEFAULT_AUTOMATION_BUDGET },
  }
}

export function filterAutomationRecords<T extends AutomationControlRecord>(
  records: T[],
  input: { query?: string; state?: "all" | "active" | "draft" | "paused" | "error" },
): T[] {
  const query = input.query?.trim().toLocaleLowerCase() ?? ""
  return records.filter((record) => {
    if (input.state && input.state !== "all") {
      if (input.state === "error") {
        if (record.approval.state !== "denied" && record.approval.state !== "revoked") return false
      } else if (record.state !== input.state) return false
    }
    if (!query) return true
    const haystack = [
      record.draft.name,
      record.draft.description,
      record.draft.scope.type,
      record.draft.trigger.type,
      record.draft.run.harness,
      record.draft.run.model,
      record.approval.state,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
    return haystack.includes(query)
  })
}

export function previewCreate(draft: AutomationDraft): AutomationMutationPreview {
  return {
    action: "Create disabled draft",
    consequence: "Creates one local record. It cannot run until reviewed and enabled.",
    requiresApproval: true,
    rows: exactDraftRows(null, draft),
  }
}

export function previewUpdate(
  current: AutomationControlRecord,
  next: AutomationDraft,
  impact: AutomationImpact,
): AutomationMutationPreview {
  const changed = new Set(impact.changedFields)
  const all = exactDraftRows(current.draft, next)
  const rows = all.filter((row) => row.before !== row.after)
  return {
    action: "Save automation changes",
    consequence: impact.requiresApproval
      ? "Authority or budget expands. Saving returns this automation to a disabled approval state."
      : "Saves the shown local fields without launching a run.",
    requiresApproval: impact.requiresApproval,
    rows:
      rows.length > 0
        ? rows.map((row) => ({
            ...row,
            field: changed.has(row.field) ? `${row.field} (classified impact)` : row.field,
          }))
        : [{ field: "Record", before: "No changes", after: "No changes" }],
  }
}

export function previewLifecycle(input: {
  action: "approve" | "approve-enable" | "deny" | "enable" | "pause" | "archive" | "fire" | "kill"
  record: AutomationControlRecord
  occurrenceId?: string
}): AutomationMutationPreview {
  const { action, record } = input
  const rows: AutomationMutationPreview["rows"] = []
  let consequence = ""
  if (action === "approve" || action === "approve-enable" || action === "deny") {
    rows.push({
      field: "Approval",
      before: record.approval.state,
      after: action === "deny" ? "denied" : "approved",
    })
    rows.push({
      field: "Enabled",
      before: String(record.enabled),
      after: String(action === "approve-enable"),
    })
    consequence =
      action === "deny"
        ? "Records denial and leaves the automation unable to run."
        : action === "approve-enable"
          ? "Approves this exact authority and budget, then allows future triggers to run."
          : "Approves this exact authority and budget but leaves execution paused."
  } else if (action === "enable") {
    rows.push({ field: "Enabled", before: String(record.enabled), after: "true" })
    rows.push({ field: "State", before: record.state, after: "active" })
    consequence = "Allows future matching triggers to create local runs while Flapstack is open."
  } else if (action === "pause") {
    rows.push({ field: "Enabled", before: String(record.enabled), after: "false" })
    rows.push({ field: "State", before: record.state, after: "paused" })
    consequence = "Stops future triggers. A currently running occurrence is not killed."
  } else if (action === "archive") {
    rows.push({ field: "State", before: record.state, after: "archived" })
    rows.push({ field: "Approval", before: record.approval.state, after: "revoked" })
    consequence =
      "Archives the definition and prevents future triggers. Existing evidence remains stored."
  } else if (action === "fire") {
    rows.push({
      field: "Trigger",
      before: JSON.stringify(record.draft.trigger),
      after: "one new manual occurrence",
    })
    rows.push({
      field: "Target",
      before: "no new target resolution",
      after: JSON.stringify({ scope: record.draft.scope, action: record.draft.action }),
    })
    rows.push({
      field: "Authority",
      before: "no new authority snapshot",
      after: JSON.stringify(record.draft.run),
    })
    rows.push({
      field: "Budget",
      before: "no new budget snapshot",
      after: JSON.stringify(record.draft.budget),
    })
    consequence =
      "Queues one local occurrence. The scheduler may launch it with the shown target, authority, and budget while Flapstack is open."
  } else {
    rows.push({ field: "Occurrence", before: input.occurrenceId ?? "unknown", after: "cancelled" })
    rows.push({
      field: "Retry",
      before: record.draft.retry.mode,
      after: "disabled for this occurrence",
    })
    consequence = "Cancels this occurrence and its active run, and prevents any later retry for it."
  }
  return {
    action: label(action),
    consequence,
    requiresApproval: action === "enable" || action.startsWith("approve"),
    rows,
  }
}

export function exactDraftRows(
  before: AutomationDraft | null,
  after: AutomationDraft,
): AutomationMutationPreview["rows"] {
  const values = (draft: AutomationDraft | null): Record<string, string> => ({
    Name: draft?.name ?? "not created",
    Description: draft?.description || "none",
    Scope: draft ? formatValue(draft.scope) : "none",
    Action: draft ? formatValue(draft.action) : "none",
    Trigger: draft ? formatValue(draft.trigger) : "none",
    Prompt: draft?.run.prompt ?? "none",
    "run.harness": draft?.run.harness ?? "none",
    "run.model": draft?.run.model ?? "provider default",
    "run.permissionMode": draft?.run.permissionMode ?? "none",
    "run.customPermissions": draft ? formatValue(draft.run.customPermissions ?? null) : "none",
    "run.worktree": draft
      ? formatValue({ strategy: draft.run.worktreeStrategy, path: draft.run.worktreePath ?? null })
      : "none",
    Retry: draft ? formatValue(draft.retry) : "none",
    "budget.maxDurationMs": formatLimit(draft?.budget.maxDurationMs, "ms"),
    "budget.maxTotalTokens": formatLimit(draft?.budget.maxTotalTokens, "tokens"),
    "budget.maxCostUsdMicros": formatLimit(draft?.budget.maxCostUsdMicros, "micros USD"),
    "budget.maxConcurrentRuns": String(draft?.budget.maxConcurrentRuns ?? "none"),
  })
  const oldValues = values(before)
  const newValues = values(after)
  return Object.keys(newValues).map((field) => ({
    field,
    before: oldValues[field] ?? "none",
    after: newValues[field] ?? "none",
  }))
}

export function formatAutomationError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return "Local automation request failed. No success state was recorded."
}

function formatValue(value: unknown): string {
  return JSON.stringify(value)
}

function formatLimit(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? "unlimited" : `${value} ${unit}`
}

function label(action: string): string {
  return action.replace(/-/g, " ").replace(/^./, (character) => character.toUpperCase())
}
