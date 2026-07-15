"use client"

import "./automations-styles.css"
import { useCallback, useEffect, useMemo, useReducer, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { ArrowLeft, ExternalLink, Play, Save, ShieldCheck, Trash2, XCircle } from "lucide-react"
import {
  automationDraftSchema,
  DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES,
  type AutomationDraft,
} from "../../../shared/automation"
import { AGENT_HARNESSES } from "../../../shared/harness-types"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
} from "../../../shared/permission-capabilities"
import type { AutomationControlRecord } from "../../../main/lib/automation/control-service"
import { trpc, trpcClient } from "../../lib/trpc"
import { chatSourceModeAtom } from "../../lib/atoms"
import {
  automationDetailIdAtom,
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
} from "../agents/atoms"
import { detailsSidebarOpenAtom, detailsSidebarTabAtom } from "../details-sidebar/atoms"
import { automationEvidenceRunIdAtom } from "./state"
import {
  AUTOMATION_A11Y,
  automationUiReducer,
  createDefaultAutomationDraft,
  formatAutomationError,
  initialAutomationUiState,
  previewCreate,
  previewLifecycle,
  previewUpdate,
  type AutomationMutationPreview,
} from "./automation-ui-model"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"

type PendingAction =
  | "create"
  | "update"
  | "approve"
  | "approve-enable"
  | "deny"
  | "enable"
  | "pause"
  | "archive"
  | "fire"
  | "kill"

export function AutomationsDetailView() {
  const automationId = useAtomValue(automationDetailIdAtom)
  const setAutomationId = useSetAtom(automationDetailIdAtom)
  const isCreate = automationId === "new"
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [draft, setDraft] = useState<AutomationDraft>(createDefaultAutomationDraft)
  const [uiState, dispatch] = useReducer(automationUiReducer, initialAutomationUiState)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [pendingOccurrenceId, setPendingOccurrenceId] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null)
  const utils = trpc.useUtils()

  const recordQuery = trpc.automations.get.useQuery(
    { automationId: automationId ?? "" },
    { enabled: !isCreate && Boolean(automationId), refetchInterval: 5_000 },
  )
  const historyQuery = trpc.automations.history.useQuery(
    { automationId: automationId ?? "", limit: 100 },
    { enabled: !isCreate && Boolean(automationId), refetchInterval: 5_000 },
  )
  const projects = trpc.projects.list.useQuery()
  const tasks = trpc.tasks.list.useQuery({ includeArchived: false })
  const chats = trpc.chats.list.useQuery({})

  const createMutation = trpc.automations.createDraft.useMutation()
  const updateMutation = trpc.automations.update.useMutation()
  const reviewMutation = trpc.automations.reviewDraft.useMutation()
  const enableMutation = trpc.automations.setEnabled.useMutation()
  const pauseMutation = trpc.automations.pause.useMutation()
  const archiveMutation = trpc.automations.delete.useMutation()
  const dryRunMutation = trpc.automations.dryRun.useMutation()
  const fireMutation = trpc.automations.fireManual.useMutation()
  const killMutation = trpc.automations.kill.useMutation()

  const record = recordQuery.data
  useEffect(() => {
    if (record) setDraft(record.draft)
  }, [record])

  const parsed = useMemo(() => automationDraftSchema.safeParse(draft), [draft])
  const validationMessage = parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Automation draft is invalid.")

  const back = useCallback(() => setDesktopView("automations"), [setDesktopView])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uiState.pendingMutation) back()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void requestSave()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const requestPreview = (
    action: PendingAction,
    preview: AutomationMutationPreview,
    occurrenceId?: string,
  ) => {
    setPendingAction(action)
    setPendingOccurrenceId(occurrenceId ?? null)
    dispatch({ type: "preview", preview })
  }

  async function requestSave() {
    if (!parsed.success) {
      dispatch({ type: "error", message: validationMessage ?? "Automation draft is invalid." })
      return
    }
    if (isCreate) {
      requestPreview("create", previewCreate(parsed.data))
      return
    }
    if (!record) return
    try {
      const impact = await trpcClient.automations.classifyImpact.query({
        automationId: record.id,
        draft: parsed.data,
      })
      requestPreview("update", previewUpdate(record, parsed.data, impact))
    } catch (error) {
      dispatch({ type: "error", message: formatAutomationError(error) })
    }
  }

  async function refresh() {
    await Promise.all([
      utils.automations.list.invalidate(),
      utils.automations.get.invalidate(),
      utils.automations.history.invalidate(),
      utils.automations.inbox.invalidate(),
    ])
  }

  async function confirmMutation() {
    if (!pendingAction) return
    const validatedDraft = parsed.success ? parsed.data : null
    if ((pendingAction === "create" || pendingAction === "update") && !validatedDraft) {
      dispatch({ type: "error", message: validationMessage ?? "Automation draft is invalid." })
      return
    }
    dispatch({ type: "submit" })
    try {
      let message = "Automation updated."
      if (pendingAction === "create") {
        const result = await createMutation.mutateAsync({ draft: validatedDraft! })
        message = "Disabled local draft created. Review is still required."
        setAutomationId(result.record.id)
      } else if (!record) return
      else if (pendingAction === "update") {
        await updateMutation.mutateAsync({
          automationId: record.id,
          expectedVersion: record.version,
          draft: validatedDraft!,
        })
        message = "Exact changes saved. Approval state refreshed."
      } else if (
        pendingAction === "approve" ||
        pendingAction === "approve-enable" ||
        pendingAction === "deny"
      ) {
        await reviewMutation.mutateAsync({
          automationId: record.id,
          expectedVersion: record.version,
          decision: pendingAction === "deny" ? "deny" : "approve",
          enable: pendingAction === "approve-enable",
        })
        message =
          pendingAction === "deny"
            ? "Draft denied and left disabled."
            : pendingAction === "approve-enable"
              ? "Draft approved and enabled."
              : "Draft approved and paused."
      } else if (pendingAction === "enable") {
        await enableMutation.mutateAsync({
          automationId: record.id,
          expectedVersion: record.version,
          enabled: true,
        })
        message = "Automation enabled for future triggers."
      } else if (pendingAction === "pause") {
        await pauseMutation.mutateAsync({ automationId: record.id })
        message = "Automation paused. Running occurrences were not killed."
      } else if (pendingAction === "archive") {
        await archiveMutation.mutateAsync({
          automationId: record.id,
          expectedVersion: record.version,
        })
        message = "Automation archived; evidence retained."
      } else if (pendingAction === "fire") {
        const result = await fireMutation.mutateAsync({ automationId: record.id })
        message =
          result.status === "created"
            ? "Manual occurrence queued."
            : `Manual trigger ${result.status}.`
      } else if (pendingAction === "kill" && pendingOccurrenceId) {
        await killMutation.mutateAsync({
          automationId: record.id,
          occurrenceId: pendingOccurrenceId,
        })
        message = "Occurrence killed and retry disabled."
      }
      await refresh()
      dispatch({ type: "success", message })
      if (pendingAction === "archive") back()
    } catch (error) {
      dispatch({ type: "error", message: formatAutomationError(error) })
    } finally {
      setPendingAction(null)
      setPendingOccurrenceId(null)
    }
  }

  async function runDryRun() {
    if (!record) return
    setDryRun(null)
    try {
      const result = await dryRunMutation.mutateAsync({ automationId: record.id })
      setDryRun(result as unknown as Record<string, unknown>)
      dispatch({
        type: "success",
        message: "Dry-run resolved locally. No run or project write was created.",
      })
    } catch (error) {
      dispatch({ type: "error", message: formatAutomationError(error) })
    }
  }

  if (!isCreate && recordQuery.isLoading) return <Centered message="Loading local automation…" />
  if (!isCreate && (recordQuery.error || !record))
    return <Centered message={recordQuery.error?.message ?? "Automation not found."} alert />

  return (
    <main className="h-full overflow-y-auto bg-background" aria-label={AUTOMATION_A11Y.editor}>
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={back}
              className="rounded-md p-1.5 hover:bg-muted"
              aria-label="Back to local automations"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">
                {isCreate ? "New local automation" : record!.draft.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                Desktop app open only · maximum one concurrent run · local evidence retained
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isCreate && (
              <LifecycleActions
                record={record!}
                requestPreview={requestPreview}
                dryRun={runDryRun}
              />
            )}
            <button
              type="button"
              onClick={() => void requestSave()}
              disabled={uiState.status === "saving" || !parsed.success}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isCreate ? "Review draft" : "Review changes"}
            </button>
          </div>
        </header>

        <div aria-live="polite" className="min-h-8 py-2 text-sm">
          {validationMessage && (
            <p role="alert" className="text-red-600">
              {validationMessage}
            </p>
          )}
          {uiState.message && (
            <p
              role={uiState.status === "error" ? "alert" : "status"}
              className={uiState.status === "error" ? "text-red-600" : "text-muted-foreground"}
            >
              {uiState.message}
            </p>
          )}
        </div>

        {!isCreate && <HonestState record={record!} />}

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <AutomationEditor
            draft={draft}
            setDraft={setDraft}
            projects={projects.data ?? []}
            tasks={tasks.data ?? []}
            chats={chats.data ?? []}
          />
          <aside className="space-y-4">
            <ExactConfiguration draft={draft} />
            {dryRun && <ResolvedDryRun value={dryRun} />}
            {!isCreate && (
              <History
                items={historyQuery.data ?? []}
                record={record!}
                requestPreview={requestPreview}
                projects={projects.data ?? []}
                tasks={tasks.data ?? []}
              />
            )}
          </aside>
        </div>
      </div>

      <MutationDialog
        preview={uiState.pendingMutation}
        busy={uiState.status === "saving"}
        onCancel={() => dispatch({ type: "cancel-preview" })}
        onConfirm={() => void confirmMutation()}
      />
    </main>
  )
}

function LifecycleActions({
  record,
  requestPreview,
  dryRun,
}: {
  record: AutomationControlRecord
  requestPreview: (
    action: PendingAction,
    preview: AutomationMutationPreview,
    occurrenceId?: string,
  ) => void
  dryRun: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={dryRun}
        className="h-8 rounded-md border px-3 text-sm hover:bg-muted"
      >
        Dry-run
      </button>
      {record.draft.trigger.type === "manual" && record.enabled && (
        <button
          type="button"
          onClick={() => requestPreview("fire", previewLifecycle({ action: "fire", record }))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
        >
          <Play className="h-3.5 w-3.5" />
          Run now
        </button>
      )}
      {record.approval.state === "pending" && (
        <button
          type="button"
          onClick={() => requestPreview("approve", previewLifecycle({ action: "approve", record }))}
          className="h-8 rounded-md border px-3 text-sm"
        >
          Approve paused
        </button>
      )}
      {record.approval.state === "pending" && (
        <button
          type="button"
          onClick={() =>
            requestPreview("approve-enable", previewLifecycle({ action: "approve-enable", record }))
          }
          className="h-8 rounded-md border px-3 text-sm"
        >
          Approve + enable
        </button>
      )}
      {record.approval.state === "pending" && (
        <button
          type="button"
          onClick={() => requestPreview("deny", previewLifecycle({ action: "deny", record }))}
          className="h-8 rounded-md border border-red-500/30 px-3 text-sm text-red-600"
        >
          Deny
        </button>
      )}
      {record.enabled ? (
        <button
          type="button"
          onClick={() => requestPreview("pause", previewLifecycle({ action: "pause", record }))}
          className="h-8 rounded-md border px-3 text-sm"
        >
          Pause
        </button>
      ) : (
        record.approval.state === "approved" && (
          <button
            type="button"
            onClick={() => requestPreview("enable", previewLifecycle({ action: "enable", record }))}
            className="h-8 rounded-md border px-3 text-sm"
          >
            Enable
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => requestPreview("archive", previewLifecycle({ action: "archive", record }))}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-red-600"
        aria-label="Archive automation"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </>
  )
}

function HonestState({ record }: { record: AutomationControlRecord }) {
  const error = record.approval.state === "denied" || record.approval.state === "revoked"
  return (
    <section
      className={`rounded-lg border p-3 text-sm ${error ? "border-red-500/30 bg-red-500/5" : "bg-card"}`}
      aria-label="Automation state"
    >
      <div className="flex flex-wrap items-center gap-2">
        {error ? (
          <XCircle className="h-4 w-4 text-red-600" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
        )}
        <strong className="capitalize">{record.state}</strong>
        <span className="rounded border px-1.5 py-0.5 text-xs capitalize">
          Approval {record.approval.state}
        </span>
        <span className="rounded border px-1.5 py-0.5 text-xs">
          {record.enabled ? "Enabled" : "Not runnable"}
        </span>
        {record.creator.type === "agent" && (
          <span className="text-xs text-muted-foreground">
            Agent-created draft from chat {record.creator.chatId}
          </span>
        )}
      </div>
      {record.approval.state === "pending" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Review the exact trigger, target, authority, and budget below. Pending drafts never run.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          This definition is denied or revoked and cannot run. Edit it to create a new reviewable
          state.
        </p>
      )}
    </section>
  )
}

function AutomationEditor({
  draft,
  setDraft,
  projects,
  tasks,
  chats,
}: {
  draft: AutomationDraft
  setDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; name: string; projectId: string }>
  chats: Array<{ id: string; name: string | null; projectId: string | null; taskId: string | null }>
}) {
  const patch = (next: Partial<AutomationDraft>) => setDraft((current) => ({ ...current, ...next }))
  const scopeType = draft.scope.type
  const createTaskAction = draft.action.type === "create-task-run" ? draft.action : null
  const scheduleTrigger = draft.trigger.type === "schedule" ? draft.trigger : null
  const fileTrigger = draft.trigger.type === "file-change" ? draft.trigger : null
  const setScope = (type: AutomationDraft["scope"]["type"], id?: string) => {
    const scope =
      type === "global"
        ? ({ type } as const)
        : type === "project"
          ? ({ type, projectId: id ?? projects[0]?.id ?? "" } as const)
          : type === "task"
            ? ({ type, taskId: id ?? tasks[0]?.id ?? "" } as const)
            : ({ type, chatId: id ?? chats[0]?.id ?? "" } as const)
    const action =
      type === "chat"
        ? ({ type: "run-chat" } as const)
        : draft.action.type === "run-chat" ||
            (draft.action.type === "create-task-run" && type !== "project")
          ? ({ type: "create-chat-run" } as const)
          : draft.action
    const run =
      draft.run.worktreeStrategy === "task-primary" &&
      type !== "task" &&
      action.type !== "create-task-run"
        ? { ...draft.run, worktreeStrategy: "inherit" as const, worktreePath: undefined }
        : draft.run
    patch({ scope, action, run })
  }
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <Fieldset legend="Identity and target">
        <TextField label="Name" value={draft.name} onChange={(name) => patch({ name })} required />
        <TextField
          label="Description"
          value={draft.description ?? ""}
          onChange={(description) => patch({ description: description || null })}
          multiline
        />
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label="Target scope"
            value={scopeType}
            onChange={(value) => setScope(value as AutomationDraft["scope"]["type"])}
            options={["global", "project", "task", "chat"]}
          />
          {scopeType === "project" && (
            <SelectField
              label="Project"
              value={draft.scope.projectId}
              onChange={(id) => setScope("project", id)}
              options={projects.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
          {scopeType === "task" && (
            <SelectField
              label="Task"
              value={draft.scope.taskId}
              onChange={(id) => setScope("task", id)}
              options={tasks.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
          {scopeType === "chat" && (
            <SelectField
              label="Chat"
              value={draft.scope.chatId}
              onChange={(id) => setScope("chat", id)}
              options={chats.map((item) => ({ value: item.id, label: item.name || item.id }))}
            />
          )}
          <SelectField
            label="Action"
            value={draft.action.type}
            onChange={(value) =>
              patch({
                action:
                  value === "run-chat"
                    ? { type: "run-chat" }
                    : value === "create-task-run"
                      ? { type: "create-task-run", taskName: "Automated task" }
                      : { type: "create-chat-run" },
              })
            }
            options={
              scopeType === "chat"
                ? ["run-chat"]
                : scopeType === "project"
                  ? ["create-chat-run", "create-task-run"]
                  : ["create-chat-run"]
            }
          />
        </div>
        {createTaskAction && (
          <TextField
            label="Created task name"
            value={createTaskAction.taskName}
            onChange={(taskName) => patch({ action: { ...createTaskAction, taskName } })}
            required
          />
        )}
      </Fieldset>

      <Fieldset legend="Trigger">
        <SelectField
          label="Trigger type"
          value={draft.trigger.type}
          onChange={(value) =>
            patch({ trigger: newTrigger(value as AutomationDraft["trigger"]["type"], draft) })
          }
          options={["manual", "schedule", "run-complete", "file-change"]}
        />
        {scheduleTrigger && (
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Cron expression"
              value={scheduleTrigger.cron}
              onChange={(cron) => patch({ trigger: { ...scheduleTrigger, cron } })}
              required
            />
            <TextField
              label="Timezone"
              value={scheduleTrigger.timezone}
              onChange={(timezone) => patch({ trigger: { ...scheduleTrigger, timezone } })}
              required
            />
            <SelectField
              label="Missed schedule catch-up"
              value={scheduleTrigger.catchUp}
              onChange={(catchUp) =>
                patch({ trigger: { ...scheduleTrigger, catchUp: catchUp as "none" | "one" } })
              }
              options={[
                { value: "one", label: "At most one" },
                { value: "none", label: "None" },
              ]}
            />
          </div>
        )}
        {draft.trigger.type === "run-complete" && (
          <RunCompleteEditor
            trigger={draft.trigger}
            setTrigger={(trigger) => patch({ trigger })}
            projects={projects}
            tasks={tasks}
            chats={chats}
          />
        )}
        {fileTrigger && (
          <div className="space-y-3">
            <TextField
              label="Registered root path"
              value={fileTrigger.rootPath}
              onChange={(rootPath) => patch({ trigger: { ...fileTrigger, rootPath } })}
              required
            />
            <TextField
              label="Include globs, one per line"
              value={fileTrigger.includeGlobs.join("\n")}
              onChange={(value) =>
                patch({ trigger: { ...fileTrigger, includeGlobs: lines(value) } })
              }
              multiline
            />
            <TextField
              label="Exclude globs, one per line"
              value={fileTrigger.excludeGlobs.join("\n")}
              onChange={(value) =>
                patch({ trigger: { ...fileTrigger, excludeGlobs: lines(value) } })
              }
              multiline
            />
            <NumberField
              label="Debounce milliseconds"
              value={fileTrigger.debounceMs}
              onChange={(debounceMs) =>
                patch({ trigger: { ...fileTrigger, debounceMs: debounceMs ?? 1000 } })
              }
            />
          </div>
        )}
      </Fieldset>

      <Fieldset legend="Run authority">
        <TextField
          label="Prompt"
          value={draft.run.prompt}
          onChange={(prompt) => patch({ run: { ...draft.run, prompt } })}
          multiline
          required
        />
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label="Harness"
            value={draft.run.harness}
            onChange={(harness) =>
              patch({
                run: { ...draft.run, harness: harness as AutomationDraft["run"]["harness"] },
              })
            }
            options={[...AGENT_HARNESSES]}
          />
          <TextField
            label="Model override"
            value={draft.run.model ?? ""}
            onChange={(model) => patch({ run: { ...draft.run, model: model || undefined } })}
            placeholder="Provider default"
          />
          <SelectField
            label="Permission mode"
            value={draft.run.permissionMode}
            onChange={(permissionMode) =>
              patch({
                run: {
                  ...draft.run,
                  permissionMode: permissionMode as AutomationDraft["run"]["permissionMode"],
                  customPermissions:
                    permissionMode === "custom"
                      ? (draft.run.customPermissions ?? disabledCustomPermissions)
                      : undefined,
                },
              })
            }
            options={[
              "read-only",
              "ask-before-edits",
              "auto-edit-project-only",
              "full-access",
              "custom",
            ]}
          />
          <SelectField
            label="Worktree strategy"
            value={draft.run.worktreeStrategy}
            onChange={(worktreeStrategy) =>
              patch({
                run: {
                  ...draft.run,
                  worktreeStrategy: worktreeStrategy as AutomationDraft["run"]["worktreeStrategy"],
                  worktreePath:
                    worktreeStrategy === "existing" ? (draft.run.worktreePath ?? "") : undefined,
                },
              })
            }
            options={
              draft.scope.type === "task" || draft.action.type === "create-task-run"
                ? ["inherit", "task-primary", "existing", "none"]
                : ["inherit", "existing", "none"]
            }
          />
        </div>
        {draft.run.worktreeStrategy === "existing" && (
          <TextField
            label="Registered worktree path"
            value={draft.run.worktreePath ?? ""}
            onChange={(worktreePath) => patch({ run: { ...draft.run, worktreePath } })}
            required
          />
        )}
        {draft.run.permissionMode === "custom" && (
          <div className="grid gap-2 sm:grid-cols-2" aria-label="Custom authority capabilities">
            {customPermissionCapabilityKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 rounded border p-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.run.customPermissions?.[key] ?? false}
                  onChange={(event) =>
                    patch({
                      run: {
                        ...draft.run,
                        customPermissions: {
                          ...(draft.run.customPermissions ?? disabledCustomPermissions),
                          [key]: event.target.checked,
                        },
                      },
                    })
                  }
                />
                {key}
              </label>
            ))}
          </div>
        )}
      </Fieldset>

      <Fieldset legend="Budget and retry">
        <div className="grid gap-3 md:grid-cols-2">
          <NumberField
            label="Maximum duration (ms)"
            value={draft.budget.maxDurationMs}
            onChange={(maxDurationMs) => patch({ budget: { ...draft.budget, maxDurationMs } })}
            nullable
          />
          <NumberField
            label="Maximum total tokens"
            value={draft.budget.maxTotalTokens}
            onChange={(maxTotalTokens) => patch({ budget: { ...draft.budget, maxTotalTokens } })}
            nullable
          />
          <NumberField
            label="Maximum cost (USD micros)"
            value={draft.budget.maxCostUsdMicros}
            onChange={(maxCostUsdMicros) =>
              patch({ budget: { ...draft.budget, maxCostUsdMicros } })
            }
            nullable
          />
          <NumberField label="Maximum concurrent runs" value={1} onChange={() => {}} disabled />
          <SelectField
            label="Retry policy"
            value={draft.retry.mode}
            onChange={(mode) =>
              patch({
                retry:
                  mode === "none"
                    ? {
                        mode: "none",
                        maxAttempts: 1,
                        initialDelayMs: 0,
                        maxDelayMs: 0,
                        deadlineMs: 0,
                      }
                    : {
                        mode: "exponential",
                        maxAttempts: 2,
                        initialDelayMs: 1000,
                        maxDelayMs: 60000,
                        deadlineMs: 3600000,
                      },
              })
            }
            options={["none", "exponential"]}
          />
        </div>
        {draft.retry.mode === "exponential" && (
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Maximum attempts"
              value={draft.retry.maxAttempts}
              onChange={(maxAttempts) =>
                patch({ retry: { ...draft.retry, maxAttempts: maxAttempts ?? 2 } })
              }
            />
            <NumberField
              label="Initial delay (ms)"
              value={draft.retry.initialDelayMs}
              onChange={(initialDelayMs) =>
                patch({ retry: { ...draft.retry, initialDelayMs: initialDelayMs ?? 1000 } })
              }
            />
            <NumberField
              label="Maximum delay (ms)"
              value={draft.retry.maxDelayMs}
              onChange={(maxDelayMs) =>
                patch({ retry: { ...draft.retry, maxDelayMs: maxDelayMs ?? 60000 } })
              }
            />
            <NumberField
              label="Retry deadline (ms)"
              value={draft.retry.deadlineMs}
              onChange={(deadlineMs) =>
                patch({ retry: { ...draft.retry, deadlineMs: deadlineMs ?? 3600000 } })
              }
            />
          </div>
        )}
      </Fieldset>
    </form>
  )
}

function RunCompleteEditor({
  trigger,
  setTrigger,
  projects,
  tasks,
  chats,
}: {
  trigger: Extract<AutomationDraft["trigger"], { type: "run-complete" }>
  setTrigger: (trigger: Extract<AutomationDraft["trigger"], { type: "run-complete" }>) => void
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; name: string }>
  chats: Array<{ id: string; name: string | null }>
}) {
  const sourceType = trigger.projectId ? "project" : trigger.taskId ? "task" : "chat"
  const sourceId = trigger.projectId ?? trigger.taskId ?? trigger.chatId ?? ""
  const options =
    sourceType === "project"
      ? projects
      : sourceType === "task"
        ? tasks
        : chats.map((chat) => ({ ...chat, name: chat.name || chat.id }))
  const setSource = (type: string, id: string) =>
    setTrigger({
      type: "run-complete",
      ...(type === "project"
        ? { projectId: id }
        : type === "task"
          ? { taskId: id }
          : { chatId: id }),
      statuses: trigger.statuses,
    })
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <SelectField
        label="Completed run source"
        value={sourceType}
        onChange={(type) => {
          const list = type === "project" ? projects : type === "task" ? tasks : chats
          setSource(type, list[0]?.id ?? "")
        }}
        options={["project", "task", "chat"]}
      />
      <SelectField
        label="Source"
        value={sourceId}
        onChange={(id) => setSource(sourceType, id)}
        options={options.map((item) => ({ value: item.id, label: item.name ?? item.id }))}
      />
      <div className="md:col-span-2">
        <span className="text-xs font-medium">Terminal statuses</span>
        <div className="mt-1 flex gap-3">
          {(["success", "failure", "cancelled"] as const).map((status) => (
            <label key={status} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={trigger.statuses.includes(status)}
                onChange={(event) =>
                  setTrigger({
                    ...trigger,
                    statuses: event.target.checked
                      ? [...trigger.statuses, status]
                      : trigger.statuses.filter((value) => value !== status),
                  })
                }
              />
              {status}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExactConfiguration({ draft }: { draft: AutomationDraft }) {
  return (
    <section className="rounded-lg border bg-card p-4" aria-label="Exact current configuration">
      <h2 className="text-sm font-semibold">Exact current configuration</h2>
      <dl className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Trigger</dt>
        <dd className="break-all">{JSON.stringify(draft.trigger)}</dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd className="break-all">
          {JSON.stringify({ scope: draft.scope, action: draft.action })}
        </dd>
        <dt className="text-muted-foreground">Authority</dt>
        <dd className="break-all">{JSON.stringify(draft.run)}</dd>
        <dt className="text-muted-foreground">Budget</dt>
        <dd className="break-all">{JSON.stringify(draft.budget)}</dd>
        <dt className="text-muted-foreground">Retry</dt>
        <dd className="break-all">{JSON.stringify(draft.retry)}</dd>
      </dl>
    </section>
  )
}

function ResolvedDryRun({ value }: { value: Record<string, unknown> }) {
  return (
    <section
      className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4"
      aria-label="Resolved dry-run preview"
    >
      <h2 className="text-sm font-semibold">Resolved dry-run</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        No run launched. No project file changed.
      </p>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  )
}

function History({
  items,
  record,
  requestPreview,
  projects,
  tasks,
}: {
  items: Array<{
    executionId: string
    occurrenceId: string
    state: string
    runId: string | null
    chatId: string | null
    taskId: string | null
    projectId: string | null
    attempt: number
    startedAt: number | null
    completedAt: number | null
    stopReason: string | null
  }>
  record: AutomationControlRecord
  requestPreview: (
    action: PendingAction,
    preview: AutomationMutationPreview,
    occurrenceId?: string,
  ) => void
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; name: string; projectId: string }>
}) {
  const navigate = useAutomationEvidenceNavigation(projects, tasks)
  return (
    <section className="rounded-lg border bg-card p-4" aria-label={AUTOMATION_A11Y.history}>
      <h2 className="text-sm font-semibold">Execution history</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No execution attempts recorded.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.executionId} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">
                  {item.state} · attempt {item.attempt}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(item.completedAt ?? item.startedAt)}
                </span>
              </div>
              {item.stopReason && <p className="mt-1 text-red-600">{item.stopReason}</p>}
              <div className="mt-2 flex gap-2">
                {(item.chatId || item.taskId || item.projectId) && (
                  <button
                    type="button"
                    onClick={() => navigate(item)}
                    className="inline-flex items-center gap-1 rounded border px-2 py-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open evidence
                  </button>
                )}
                {item.state === "running" && (
                  <button
                    type="button"
                    onClick={() =>
                      requestPreview(
                        "kill",
                        previewLifecycle({
                          action: "kill",
                          record,
                          occurrenceId: item.occurrenceId,
                        }),
                        item.occurrenceId,
                      )
                    }
                    className="rounded border border-red-500/30 px-2 py-1 text-red-600"
                  >
                    Kill
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function useAutomationEvidenceNavigation(
  projects: Array<{ id: string; name: string }>,
  tasks: Array<{ id: string; name: string; projectId: string }>,
) {
  const setChatId = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  const setRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setScope = useSetAtom(selectedChatScopeAtom)
  const setSource = useSetAtom(chatSourceModeAtom)
  const setView = useSetAtom(desktopViewAtom)
  const setDetailsOpen = useSetAtom(detailsSidebarOpenAtom)
  const setDetailsTab = useSetAtom(detailsSidebarTabAtom)
  const setRunId = useSetAtom(automationEvidenceRunIdAtom)
  return (evidence: {
    chatId: string | null
    taskId: string | null
    projectId: string | null
    runId: string | null
  }) => {
    if (evidence.taskId) {
      const task = tasks.find((item) => item.id === evidence.taskId)
      const projectId = evidence.projectId ?? task?.projectId ?? null
      const project = projects.find((item) => item.id === projectId)
      setScope({
        type: "task",
        id: evidence.taskId,
        name: task?.name ?? "Task",
        projectId: projectId ?? "",
        projectName: project?.name ?? null,
      })
    } else if (evidence.projectId) {
      const project = projects.find((item) => item.id === evidence.projectId)
      setScope({ type: "project", id: evidence.projectId, name: project?.name ?? "Project" })
    }
    if (evidence.chatId) {
      setChatId(evidence.chatId)
      setOpenChatIds((current) =>
        current.includes(evidence.chatId!) ? current : [...current, evidence.chatId!],
      )
      setRemote(false)
      setSource("local")
      setDetailsOpen(true)
      setDetailsTab("details")
      setRunId(evidence.runId)
    }
    setView(null)
  }
}

function MutationDialog({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: AutomationMutationPreview | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent aria-label={AUTOMATION_A11Y.mutationPreview}>
        <AlertDialogHeader>
          <AlertDialogTitle>{preview?.action}</AlertDialogTitle>
          <AlertDialogDescription>{preview?.consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {preview && (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2">Field</th>
                  <th className="p-2">Before</th>
                  <th className="p-2">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={`${row.field}-${index}`} className="border-t align-top">
                    <th className="p-2 font-medium">{row.field}</th>
                    <td className="break-all p-2 text-muted-foreground">{row.before}</td>
                    <td className="break-all p-2">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {busy ? "Applying…" : "Apply exact mutation"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>
      {children}
    </fieldset>
  )
}
function TextField({
  label,
  value,
  onChange,
  multiline,
  required,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  required?: boolean
  placeholder?: string
}) {
  const className =
    "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
  return (
    <label className="block text-xs font-medium">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
          rows={4}
          className={className}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  )
}
function NumberField({
  label,
  value,
  onChange,
  nullable,
  disabled,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  nullable?: boolean
  disabled?: boolean
}) {
  return (
    <label className="block text-xs font-medium">
      {label}
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" && nullable ? null : Number(event.target.value))
        }
        disabled={disabled}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
      />
    </label>
  )
}
function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<string | { value: string; label: string }>
}) {
  return (
    <label className="block text-xs font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          )
        })}
      </select>
    </label>
  )
}
function Centered({ message, alert }: { message: string; alert?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p role={alert ? "alert" : undefined} className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
function formatDate(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "pending"
}
function newTrigger(
  type: AutomationDraft["trigger"]["type"],
  draft: AutomationDraft,
): AutomationDraft["trigger"] {
  if (type === "manual") return { type }
  if (type === "schedule")
    return {
      type,
      cron: "0 9 * * *",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      catchUp: "one",
    }
  if (type === "file-change")
    return {
      type,
      rootPath: "",
      includeGlobs: ["**/*"],
      excludeGlobs: [...DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES],
      debounceMs: 1000,
    }
  const source =
    draft.scope.type === "project"
      ? { projectId: draft.scope.projectId }
      : draft.scope.type === "task"
        ? { taskId: draft.scope.taskId }
        : draft.scope.type === "chat"
          ? { chatId: draft.scope.chatId }
          : { projectId: "" }
  return { type, ...source, statuses: ["success", "failure"] }
}
