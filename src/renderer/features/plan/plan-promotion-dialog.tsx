import { useEffect, useMemo, useState } from "react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"
import type { PlanCandidate, PlanSourceSnapshot } from "../../../shared/plan-sources"
import {
  planPromotionPermissionModes,
  type PlanPromotionPermissionMode,
  type PlanPromotionWorktreeMode,
} from "../../../shared/plan-task-promotion"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Textarea } from "../../components/ui/textarea"
import { trpc } from "../../lib/trpc"
import {
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"

type PromotionForm = {
  taskName: string
  taskDescription: string
  status: "backlog" | "planned" | "in-progress" | "review" | "done"
  permissionMode: PlanPromotionPermissionMode
  customPermissions: Record<string, unknown> | null
  worktreeMode: PlanPromotionWorktreeMode
  seedText: string
}

export function PlanPromotionDialog({
  sourceProjectId,
  source,
  candidate,
  onClose,
}: {
  sourceProjectId: string
  source: PlanSourceSnapshot
  candidate: PlanCandidate
  onClose: () => void
}) {
  const [targetProjectId, setTargetProjectId] = useState(sourceProjectId)
  const [form, setForm] = useState<PromotionForm | null>(null)
  const [idempotencyKey] = useState(() => {
    const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${candidate.id}`
    return `plan-promotion-${randomId}`
  })
  const utils = trpc.useUtils()
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setOpenChatIds = useSetAtom(openAgentChatIdsAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setSelectedChatScope = useSetAtom(selectedChatScopeAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)

  const reference = useMemo(
    () => ({
      sourceProjectId,
      sourceId: source.id,
      sourcePath: source.path,
      sourceFingerprint: source.fingerprint,
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
    }),
    [
      candidate.fingerprint,
      candidate.id,
      source.fingerprint,
      source.id,
      source.path,
      sourceProjectId,
    ],
  )
  const projectsQuery = trpc.projects.list.useQuery()
  const previewQuery = trpc.planSources.previewPromotion.useQuery({
    reference,
    targetProjectId,
  })

  useEffect(() => {
    if (!previewQuery.data) return
    setForm({
      taskName: previewQuery.data.task.name,
      taskDescription: previewQuery.data.task.description ?? "",
      status: previewQuery.data.task.status,
      permissionMode: previewQuery.data.permission.mode,
      customPermissions: previewQuery.data.permission.customPermissions,
      worktreeMode: previewQuery.data.worktree.mode,
      seedText: previewQuery.data.chat.seedText,
    })
  }, [previewQuery.data])

  const promotion = trpc.planSources.promoteCandidate.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.tasks.board.invalidate(),
        utils.tasks.list.invalidate(),
        utils.chats.list.invalidate(),
        utils.planSources.refresh.invalidate({ projectId: sourceProjectId }),
      ])
      setSelectedProject({
        id: result.project.id,
        name: result.project.name,
        path: result.project.path,
        gitRemoteUrl: result.project.gitRemoteUrl,
        gitProvider: result.project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: result.project.gitOwner,
        gitRepo: result.project.gitRepo,
      })
      setSelectedChatScope({
        type: "task",
        id: result.task.id,
        name: result.task.name,
        projectId: result.project.id,
        projectName: result.project.name,
      })
      setSelectedDraftId(null)
      setSelectedChatIsRemote(false)
      setOpenChatIds((current) =>
        current.includes(result.chat.id) ? current : [...current, result.chat.id],
      )
      setSelectedChatId(result.chat.id)
      setShowNewChatForm(false)
      setDesktopView(null)
      toast.success(result.created ? "Plan task created" : "Plan task already exists")
      onClose()
    },
    onError: async (error) => {
      if (error.data?.code === "CONFLICT") {
        await utils.planSources.refresh.invalidate({ projectId: sourceProjectId })
      }
      toast.error(error.message || "Plan task promotion failed")
    },
  })

  const submit = () => {
    if (!form) return
    promotion.mutate({
      reference,
      idempotencyKey,
      targetProjectId,
      taskName: form.taskName,
      taskDescription: form.taskDescription.trim() || null,
      status: form.status,
      permissionMode: form.permissionMode,
      customPermissions: form.permissionMode === "custom" ? form.customPermissions : null,
      worktreeMode: form.worktreeMode,
      seedText: form.seedText,
    })
  }

  const update = <Key extends keyof PromotionForm>(key: Key, value: PromotionForm[Key]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Promote plan candidate</DialogTitle>
          <DialogDescription>
            Review the exact task and idle seeded chat. This does not start an agent run.
          </DialogDescription>
        </DialogHeader>

        {previewQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {previewQuery.error.message}
          </div>
        ) : previewQuery.isLoading || !previewQuery.data || !form ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading preview…</p>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{candidate.title}</div>
              <div className="mt-1 break-all font-mono">
                {previewQuery.data.source.candidatePath}:{previewQuery.data.source.candidateLine}
              </div>
              <div className="mt-1 break-all font-mono">{source.fingerprint}</div>
            </div>

            <Field label="Project" htmlFor="promotion-project">
              <select
                id="promotion-project"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={targetProjectId}
                onChange={(event) => {
                  setForm(null)
                  setTargetProjectId(event.currentTarget.value)
                }}
              >
                {(projectsQuery.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Task name" htmlFor="promotion-task-name">
              <Input
                id="promotion-task-name"
                value={form.taskName}
                maxLength={256}
                onChange={(event) => update("taskName", event.currentTarget.value)}
              />
            </Field>

            <Field label="Task description" htmlFor="promotion-task-description">
              <Textarea
                id="promotion-task-description"
                value={form.taskDescription}
                onChange={(event) => update("taskDescription", event.currentTarget.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Status" htmlFor="promotion-status">
                <select
                  id="promotion-status"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.status}
                  onChange={(event) =>
                    update("status", event.currentTarget.value as PromotionForm["status"])
                  }
                >
                  <option value="backlog">Backlog</option>
                  <option value="planned">Planned</option>
                  <option value="in-progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                </select>
              </Field>

              <Field label="Permission" htmlFor="promotion-permission">
                <select
                  id="promotion-permission"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.permissionMode}
                  onChange={(event) =>
                    update(
                      "permissionMode",
                      event.currentTarget.value as PlanPromotionPermissionMode,
                    )
                  }
                >
                  {planPromotionPermissionModes.map((mode) => (
                    <option
                      key={mode}
                      value={mode}
                      disabled={mode === "custom" && !form.customPermissions}
                    >
                      {mode}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Worktree" htmlFor="promotion-worktree">
                <select
                  id="promotion-worktree"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.worktreeMode}
                  onChange={(event) =>
                    update("worktreeMode", event.currentTarget.value as PlanPromotionWorktreeMode)
                  }
                >
                  <option value="task-primary">Task default</option>
                  <option value="project-checkout">Project checkout</option>
                </select>
              </Field>
            </div>

            <p className="text-xs text-muted-foreground">
              Task default follows its primary worktree when one exists; until then it resolves to
              the project checkout. Promotion creates no worktree and stays atomic.
            </p>

            <Field label="Seed message" htmlFor="promotion-seed">
              <Textarea
                id="promotion-seed"
                className="min-h-40 font-mono text-xs"
                value={form.seedText}
                onChange={(event) => update("seedText", event.currentTarget.value)}
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              promotion.isPending ||
              previewQuery.isError ||
              !form?.taskName.trim() ||
              !form?.seedText.trim()
            }
          >
            {promotion.isPending ? "Creating…" : "Create task and chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
