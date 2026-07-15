import { useCallback, useMemo, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { AlertCircle, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import {
  agentsSidebarOpenAtom,
  desktopViewAtom,
  selectedAgentChatIdAtom,
  selectedChatScopeAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import { AgentsHeaderControls } from "../agents/ui/agents-header-controls"
import { KanbanBoard } from "./components/kanban-board"
import type { TaskKanbanCardData } from "./components/kanban-card"
import {
  selectTaskKanbanCards,
  type TaskKanbanChatFilter,
  type TaskKanbanMoveTarget,
  type TaskKanbanSort,
} from "../../../shared/task-kanban"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import { Button } from "../../components/ui/button"
import { TaskProposalTray } from "./components/task-proposal-tray"

export function KanbanView() {
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedChatScope = useSetAtom(selectedChatScopeAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const [projectId, setProjectId] = useState(selectedProject?.id ?? "all")
  const [search, setSearch] = useState("")
  const [chatFilter, setChatFilter] = useState<TaskKanbanChatFilter>("all")
  const [sort, setSort] = useState<TaskKanbanSort>("board")
  const utils = trpc.useUtils()

  const projectsQuery = trpc.projects.list.useQuery()
  const boardQuery = trpc.tasks.board.useQuery(
    { projectId: projectId === "all" ? undefined : projectId, includeArchived: false },
    { placeholderData: (previous) => previous, refetchInterval: 5_000 },
  )
  const cards = useMemo(
    () =>
      selectTaskKanbanCards(boardQuery.data ?? [], {
        search,
        chatFilter,
        sort,
      }),
    [boardQuery.data, chatFilter, search, sort],
  )
  const moveEnabled = sort === "board" && chatFilter === "all" && search.trim() === ""

  const refreshBoard = useCallback(() => utils.tasks.board.invalidate(), [utils.tasks.board])
  const moveMutation = trpc.tasks.moveCard.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.tasks.board.invalidate(), utils.tasks.list.invalidate()])
    },
    onError: async (error) => {
      await refreshBoard()
      toast.error(error.message || "Task move failed. Board refreshed.")
    },
  })
  const archiveMutation = trpc.tasks.archiveCard.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.tasks.board.invalidate(),
        utils.tasks.list.invalidate(),
        utils.tasks.listArchived.invalidate(),
      ])
      toast.success("Task archived")
    },
    onError: async (error) => {
      await refreshBoard()
      toast.error(error.message || "Task archive failed. Board refreshed.")
    },
  })

  const selectTask = useCallback(
    (card: TaskKanbanCardData, chatId: string | null) => {
      setSelectedProject({
        id: card.project.id,
        name: card.project.name,
        path: card.project.path,
        gitRemoteUrl: card.project.gitRemoteUrl,
        gitProvider: card.project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: card.project.gitOwner,
        gitRepo: card.project.gitRepo,
      })
      setSelectedChatScope({
        type: "task",
        id: card.id,
        name: card.name,
        projectId: card.projectId,
        projectName: card.project.name,
      })
      setSelectedDraftId(null)
      setSelectedChatId(chatId)
      setShowNewChatForm(false)
      setDesktopView(null)
    },
    [
      setSelectedChatId,
      setSelectedChatScope,
      setDesktopView,
      setSelectedDraftId,
      setSelectedProject,
      setShowNewChatForm,
    ],
  )

  const handleMove = useCallback(
    (card: TaskKanbanCardData, target: TaskKanbanMoveTarget) => {
      moveMutation.mutate({
        id: card.id,
        expectedVersion: card.version,
        targetStatus: target.targetStatus,
        beforeTaskId: target.beforeTaskId,
      })
    },
    [moveMutation],
  )

  if (boardQuery.isError && !boardQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <div>
          <h1 className="font-medium">Task board unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">{boardQuery.error.message}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => boardQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <AgentsHeaderControls
          isSidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
        <div>
          <h1 className="text-sm font-semibold">Tasks</h1>
          <p className="text-[11px] text-muted-foreground">Durable project work</p>
        </div>
        <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter tasks"
            aria-label="Filter task cards"
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Filter by project">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projectsQuery.data ?? []).map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={chatFilter}
          onValueChange={(value) => setChatFilter(value as TaskKanbanChatFilter)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by task activity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tasks</SelectItem>
            <SelectItem value="with-chats">With chats</SelectItem>
            <SelectItem value="without-chats">Without chats</SelectItem>
            <SelectItem value="running">Running now</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as TaskKanbanSort)}>
          <SelectTrigger className="h-8 w-[125px] text-xs" aria-label="Order task cards">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="board">Board order</SelectItem>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="name">Task name</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => boardQuery.refetch()}
          aria-label="Refresh task board"
        >
          <RefreshCw
            className={boardQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
          />
        </Button>
      </header>

      <div className="min-h-6 px-4 py-1 text-[11px] text-muted-foreground" aria-live="polite">
        {boardQuery.isError && boardQuery.data
          ? "Refresh failed. Showing the last task board."
          : boardQuery.isFetching && boardQuery.data
            ? "Refreshing task board…"
            : !moveEnabled
              ? "Choose Board order with no search or activity filter to move cards."
              : "Drag cards, or focus one and use Alt plus arrow keys to move it."}
      </div>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TaskProposalTray projectId={projectId === "all" ? undefined : projectId} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {(boardQuery.data?.length ?? 0) === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <h2 className="text-sm font-medium">No task cards</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create a task under a project. Chats alone do not become cards.
                </p>
              </div>
            </div>
          ) : cards.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <h2 className="text-sm font-medium">No tasks match these filters</h2>
                <p className="mt-1 text-xs text-muted-foreground">Clear search or selectors.</p>
              </div>
            </div>
          ) : (
            <KanbanBoard
              cards={cards}
              moveEnabled={moveEnabled && !moveMutation.isPending}
              onOpenTask={(card) => selectTask(card, null)}
              onOpenChat={(card) => selectTask(card, card.chats.latestId)}
              onMove={handleMove}
              onArchive={(card) =>
                archiveMutation.mutate({ id: card.id, expectedVersion: card.version })
              }
            />
          )}
        </div>
      </main>
    </div>
  )
}
