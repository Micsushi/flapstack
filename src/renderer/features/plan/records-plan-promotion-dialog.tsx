import { useState } from "react"
import { useSetAtom } from "jotai"
import {
  desktopViewAtom,
  selectedAgentChatIdAtom,
  openAgentChatIdsAtom,
  showNewChatFormAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { Button } from "../../components/ui/button"
import { Label } from "../../components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import type { PlanCandidate, PlanSourceSnapshot } from "../../../shared/plan-sources"

export function RecordsPlanPromotionDialog({
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
  const destinations = trpc.planSources.recordsDestinations.useQuery()
  const [selection, setSelection] = useState("")
  const localProjects = trpc.projects.list.useQuery()
  const [localProjectId, setLocalProjectId] = useState(sourceProjectId)
  const selectedLocal = localProjects.data?.find((project) => project.id === localProjectId)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSelectedChat = useSetAtom(selectedAgentChatIdAtom)
  const setOpenChats = useSetAtom(openAgentChatIdsAtom)
  const setNewChat = useSetAtom(showNewChatFormAtom)
  const setRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setScope = useSetAtom(selectedChatScopeAtom)
  const setDraft = useSetAtom(selectedDraftIdAtom)
  const setProject = useSetAtom(selectedProjectAtom)
  const utils = trpc.useUtils()
  const selected = destinations.data?.find((item) => `${item.path}:${item.projectId}` === selection)
  const pairInput = {
    reference: {
      sourceProjectId,
      sourceId: source.id,
      sourcePath: source.path,
      sourceFingerprint: source.fingerprint,
      candidateId: candidate.id,
      candidateFingerprint: candidate.fingerprint,
    },
    destinationPath: selected?.path ?? "lanes/vault/tasks.md",
    projectId: selected?.projectId ?? "",
    localProjectId,
  }
  const preview = trpc.planSources.previewPair.useQuery(pairInput, {
    enabled: Boolean(selected && selectedLocal),
    retry: false,
    staleTime: 0,
  })
  const proposal = trpc.planSources.confirmPair.useMutation({
    onError: async () => {
      await utils.planSources.previewPair.invalidate(pairInput)
    },
    onSuccess: async (result) => {
      await Promise.all([
        utils.chats.invalidate(),
        utils.planSources.sourceLinks.invalidate({ projectId: sourceProjectId }),
      ])
      if (selectedLocal) {
        setProject({
          id: selectedLocal.id,
          name: selectedLocal.name,
          path: selectedLocal.path,
          gitRemoteUrl: selectedLocal.gitRemoteUrl,
          gitOwner: selectedLocal.gitOwner,
          gitRepo: selectedLocal.gitRepo,
          gitProvider:
            selectedLocal.gitProvider === "github" ||
            selectedLocal.gitProvider === "gitlab" ||
            selectedLocal.gitProvider === "bitbucket"
              ? selectedLocal.gitProvider
              : null,
        })
        setScope({ type: "project", id: selectedLocal.id, name: selectedLocal.name })
      }
      setRemote(false)
      setDraft(null)
      setOpenChats((ids) => (ids.includes(result.chatId) ? ids : [...ids, result.chatId]))
      setSelectedChat(result.chatId)
      setNewChat(false)
      setDesktopView(null)
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !proposal.isPending && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
        showCloseButton={!proposal.isPending}
      >
        <DialogHeader>
          <DialogTitle>Create task and idle Chat</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <div>
            <p className="break-words font-medium">{candidate.title}</p>
            <p className="mt-2 break-words whitespace-pre-wrap text-sm">{candidate.body}</p>
          </div>
          <p className="break-all text-sm text-muted-foreground">
            {candidate.path}:{candidate.line}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="records-plan-destination">Records project</Label>
            <select
              id="records-plan-destination"
              className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selection}
              disabled={proposal.isPending}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">Choose a project</option>
              {destinations.data?.map((item) => (
                <option
                  key={`${item.path}:${item.projectId}`}
                  value={`${item.path}:${item.projectId}`}
                >
                  {item.projectName} · {item.path}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="records-plan-local-project">Local Chat project</Label>
            <select
              id="records-plan-local-project"
              className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={localProjectId}
              disabled={proposal.isPending}
              onChange={(event) => setLocalProjectId(event.target.value)}
            >
              <option value="">Choose a local project</option>
              {localProjects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          {preview.data && (
            <p className="break-all text-sm">
              Existing checkout: {preview.data.projectPath}
              <br />
              Permission: read-only. No worktree or run will start.
            </p>
          )}
          {preview.isFetching && <p role="status">Checking source and destination…</p>}
          {preview.error && (
            <p role="alert" className="text-sm text-destructive">
              {preview.error.message}
            </p>
          )}
          {destinations.isLoading && <p role="status">Loading Records projects…</p>}
          {destinations.isSuccess && destinations.data.length === 0 && (
            <p role="status">
              Add a project feature or task in Board before linking plan candidates.
            </p>
          )}
          {(destinations.isError || proposal.isError) && (
            <p role="alert" className="break-words text-sm text-destructive">
              {destinations.error?.message ?? proposal.error?.message}
            </p>
          )}
          {destinations.isError && (
            <Button variant="outline" onClick={() => void destinations.refetch()}>
              Retry connection
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            One confirmation creates the canonical task and an idle Chat with this source context.
            Later source edits remain visible in Plan comparisons. Claim and execution permissions
            require separate approval.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={proposal.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !selected ||
              !preview.data ||
              preview.isFetching ||
              preview.isError ||
              proposal.isPending
            }
            onClick={() => {
              if (selected && preview.data)
                proposal.mutate({ ...pairInput, expectedTarget: preview.data.expectedTarget })
            }}
          >
            {proposal.isPending ? "Creating…" : "Create task and idle Chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
