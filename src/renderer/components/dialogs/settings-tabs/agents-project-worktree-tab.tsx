import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { useAtomValue, useSetAtom } from "jotai"
import { trpc } from "../../../lib/trpc"
import { Button, buttonVariants } from "../../ui/button"
import { Input } from "../../ui/input"
import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react"
import { AIPenIcon, ExternalLinkIcon, FolderFilledIcon, ImageIcon } from "../../ui/icons"
import { invalidateProjectIcon, useProjectIcon } from "../../../lib/hooks/use-project-icon"
import { ProjectIcon } from "../../ui/project-icon"
import finderIcon from "../../../assets/app-icons/finder.png"
import { getFileManagerName, getPlatform } from "../../../lib/utils/platform"
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../ui/alert-dialog"
import { toast } from "sonner"
import { COMMAND_PROMPTS } from "../../../features/agents/commands"
import {
  agentsSettingsDialogOpenAtom,
  selectedAgentChatIdAtom,
  selectedProjectAtom,
} from "../../../lib/atoms"
import { cn } from "../../../lib/utils"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { settingsProjectsSidebarWidthAtom } from "../../../features/agents/atoms"
import {
  NewChatAgentProfileSelector,
  type NewChatAgentProfileSelectionState,
} from "../../../features/agent-profiles/new-chat-agent-profile-selector"

type ConfigDraft = {
  commands: string[]
  unixCommands: string[]
  windowsCommands: string[]
  saveTarget: "cursor" | "flapstack"
}
type ProjectDraft = {
  name: string
  savedName: string | null
  config: ConfigDraft
  savedConfig: string | null
  nameSaving: boolean
  configSaving: boolean
  nameError: string | null
  configError: string | null
}
const emptyDraft: ProjectDraft = {
  name: "",
  savedName: null,
  config: { commands: [""], unixCommands: [], windowsCommands: [], saveTarget: "flapstack" },
  savedConfig: null,
  nameSaving: false,
  configSaving: false,
  nameError: null,
  configError: null,
}

// --- Detail Panel ---
function ProjectDetail({
  projectId,
  draft,
  setDraft,
}: {
  projectId: string
  draft: ProjectDraft
  setDraft: Dispatch<SetStateAction<ProjectDraft>>
}) {
  // Get config for selected project
  const {
    data: configData,
    isLoading: isLoadingConfig,
    isFetching: isFetchingConfig,
    error: configError,
    refetch: refetchConfig,
  } = trpc.worktreeConfig.get.useQuery({ projectId }, { enabled: !!projectId })

  const saveMutation = trpc.worktreeConfig.save.useMutation()

  // For "Fill with AI" - create chat and close settings
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const utils = trpc.useUtils()
  const createChatMutation = trpc.chats.create.useMutation({
    onSuccess: async (data) => {
      const firstSubChat = data.subChats[0]
      await Promise.all([
        utils.chats.list.invalidate(),
        utils.chats.getMetadata.prefetch({ id: data.id }),
        firstSubChat
          ? utils.chats.getTranscript.prefetch({ chatId: data.id, subChatId: firstSubChat.id })
          : Promise.resolve(),
      ])
      setSettingsDialogOpen(false)
      setSelectedChatId(data.id)
    },
  })

  // Get project info
  const {
    data: project,
    isLoading: isLoadingProject,
    isFetching: isFetchingProject,
    error: projectError,
    refetch: refetchProject,
  } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId })
  const projectUnavailable = isLoadingProject || Boolean(projectError) || !project
  const configUnavailable =
    isLoadingConfig || isFetchingConfig || Boolean(configError) || !configData
  const detailReadRefreshing = isFetchingProject || isFetchingConfig
  const retryDetailReads = async () => {
    await Promise.all([refetchProject(), refetchConfig()])
  }

  // Cached project icon
  const { src: iconSrc } = useProjectIcon(project)

  // Rename mutation
  const renameMutation = trpc.projects.rename.useMutation()

  // Delete project mutation
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Project removed from list")
      setSelectedProject((current) => {
        if (current?.id === projectId) {
          return null
        }
        return current
      })
    },
    onError: (err) => {
      toast.error(`Failed to delete project: ${err.message}`)
    },
  })

  // Icon mutations
  const uploadIconMutation = trpc.projects.uploadIcon.useMutation({
    onSuccess: (data) => {
      if (!data) return // User cancelled file picker
      invalidateProjectIcon(projectId)
      refetchProject()
      toast.success("Icon updated")
    },
    onError: (err) => {
      toast.error(`Failed to upload icon: ${err.message}`)
    },
  })

  const removeIconMutation = trpc.projects.removeIcon.useMutation({
    onSuccess: () => {
      invalidateProjectIcon(projectId)
      refetchProject()
      toast.success("Icon removed")
    },
  })

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Project name editing
  const projectName = draft.name
  const setProjectName = (name: string) => setDraft((current) => ({ ...current, name }))
  const nameRequestRef = useRef(false)

  useEffect(() => {
    if (!project?.name) return
    setDraft((current) =>
      !current.nameSaving && (current.savedName === null || current.name === current.savedName)
        ? { ...current, name: project.name, savedName: project.name }
        : current,
    )
  }, [project?.name, setDraft])

  const handleNameBlur = useCallback(async () => {
    if (projectUnavailable || draft.nameSaving || nameRequestRef.current) return
    const trimmed = projectName.trim()
    if (!trimmed) {
      setDraft((current) => ({ ...current, nameError: "Enter a project name." }))
      return
    }
    if (trimmed === draft.savedName) {
      setDraft((current) => ({ ...current, nameError: null }))
      return
    }
    nameRequestRef.current = true
    setDraft((current) => ({ ...current, nameSaving: true, nameError: null }))
    try {
      const renamed = await renameMutation.mutateAsync({ id: projectId, name: trimmed })
      if (!renamed) throw new Error("Project no longer exists.")
      await utils.projects.get.cancel({ id: projectId })
      utils.projects.get.setData({ id: projectId }, renamed)
      setDraft((current) => ({ ...current, name: trimmed, savedName: trimmed, nameSaving: false }))
      void utils.projects.list.invalidate()
      toast.success("Project renamed")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setDraft((current) => ({ ...current, nameSaving: false, nameError: message }))
      toast.error(`Failed to rename: ${message}`)
    } finally {
      nameRequestRef.current = false
    }
  }, [
    projectName,
    projectId,
    projectUnavailable,
    draft.nameSaving,
    draft.savedName,
    renameMutation,
    setDraft,
    utils,
  ])

  // Local state
  const { saveTarget, commands, unixCommands, windowsCommands } = draft.config
  const setSaveTarget = (saveTarget: ConfigDraft["saveTarget"]) =>
    setDraft((current) => ({ ...current, config: { ...current.config, saveTarget } }))
  const setCommands = (commands: string[]) =>
    setDraft((current) => ({ ...current, config: { ...current.config, commands } }))
  const setUnixCommands = (unixCommands: string[]) =>
    setDraft((current) => ({ ...current, config: { ...current.config, unixCommands } }))
  const setWindowsCommands = (windowsCommands: string[]) =>
    setDraft((current) => ({ ...current, config: { ...current.config, windowsCommands } }))
  const [showPlatformSpecific, setShowPlatformSpecific] = useState(false)
  const [fillProfileSelection, setFillProfileSelection] =
    useState<NewChatAgentProfileSelectionState>(null)

  const configRequestRef = useRef(false)
  const configDisabled = configUnavailable || draft.savedConfig === null || draft.configSaving

  // Sync from server data
  useEffect(() => {
    if (configData) {
      const newSaveTarget = configData.source === "cursor" ? "cursor" : "flapstack"

      let newCommands: string[] = [""]
      let newUnix: string[] = []
      let newWin: string[] = []

      if (configData.config) {
        const isComment = (s: string) => s.trimStart().startsWith("#")
        const filterComments = (arr: string[]) => arr.filter((s) => !isComment(s))

        const generic = configData.config["setup-worktree"]
        const genericArr = Array.isArray(generic)
          ? filterComments(generic)
          : generic && !isComment(generic)
            ? [generic]
            : []
        newCommands = genericArr.length > 0 ? [...genericArr, ""] : [""]

        const unix = configData.config["setup-worktree-unix"]
        const win = configData.config["setup-worktree-windows"]

        newUnix = Array.isArray(unix)
          ? filterComments(unix)
          : unix && !isComment(unix)
            ? [unix]
            : []
        newWin = Array.isArray(win) ? filterComments(win) : win && !isComment(win) ? [win] : []

        if (unix || win) {
          setShowPlatformSpecific(true)
        }
      }

      const config: ConfigDraft = {
        commands: newCommands,
        unixCommands: newUnix,
        windowsCommands: newWin,
        saveTarget: newSaveTarget,
      }
      setDraft((current) =>
        !current.configSaving &&
        (current.savedConfig === null || JSON.stringify(current.config) === current.savedConfig)
          ? { ...current, config, savedConfig: JSON.stringify(config) }
          : current,
      )
    }
  }, [configData, setDraft])

  const doSave = useCallback(async () => {
    if (!projectId || configDisabled || configRequestRef.current) return

    const currentState = JSON.stringify({ commands, unixCommands, windowsCommands, saveTarget })
    if (currentState === draft.savedConfig) {
      setDraft((current) => ({ ...current, configError: null }))
      return
    }

    const config: Record<string, string[]> = {}
    const filteredCommands = commands.filter((c) => c.trim())
    const filteredUnix = unixCommands.filter((c) => c.trim())
    const filteredWin = windowsCommands.filter((c) => c.trim())

    if (filteredCommands.length > 0) config["setup-worktree"] = filteredCommands
    if (filteredUnix.length > 0) config["setup-worktree-unix"] = filteredUnix
    if (filteredWin.length > 0) config["setup-worktree-windows"] = filteredWin

    configRequestRef.current = true
    setDraft((current) => ({ ...current, configSaving: true, configError: null }))
    try {
      const result = await saveMutation.mutateAsync({ projectId, config, target: saveTarget })
      if (!result.success) throw new Error(result.error || "Could not save worktree config.")
      await utils.worktreeConfig.get.cancel({ projectId })
      utils.worktreeConfig.get.setData({ projectId }, (current) =>
        current ? { ...current, config, source: saveTarget, path: result.path } : current,
      )
      setDraft((current) => ({ ...current, savedConfig: currentState, configSaving: false }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setDraft((current) => ({ ...current, configSaving: false, configError: message }))
      toast.error(`Failed to save: ${message}`)
    } finally {
      configRequestRef.current = false
    }
  }, [
    projectId,
    commands,
    unixCommands,
    windowsCommands,
    saveTarget,
    saveMutation,
    configDisabled,
    draft.savedConfig,
    setDraft,
    utils,
  ])

  const updateCommand = (
    index: number,
    value: string,
    list: string[],
    setter: (v: string[]) => void,
  ) => {
    const newList = [...list]
    newList[index] = value
    setter(newList)
  }

  const pendingSaveRef = useRef(false)

  const removeCommand = (
    index: number,
    list: string[],
    setter: (v: string[]) => void,
    allowEmpty = false,
  ) => {
    if (!allowEmpty && list.length <= 1) return
    setter(list.filter((_, i) => i !== index))
    pendingSaveRef.current = true
  }

  // Save after state updates from remove or saveTarget change
  useEffect(() => {
    if (pendingSaveRef.current && !configDisabled) {
      pendingSaveRef.current = false
      doSave()
    }
  }, [commands, unixCommands, windowsCommands, saveTarget, doSave, configDisabled])

  const addCommand = (list: string[], setter: (v: string[]) => void) => {
    setter([...list, ""])
  }

  const cursorExists = configData?.available?.cursor?.exists ?? false

  const openInFinderMutation = trpc.external.openInFinder.useMutation()

  const handleOpenInFinder = () => {
    if (project?.path) {
      openInFinderMutation.mutate(project.path)
    }
  }

  // Helper to render a command list with add/remove
  const renderCommandList = (
    list: string[],
    setter: (v: string[]) => void,
    placeholder: string,
    allowEmpty = false,
  ) => (
    <div className="space-y-2">
      {list.map((cmd, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={cmd}
            onChange={(e) => updateCommand(i, e.target.value, list, setter)}
            onBlur={doSave}
            disabled={configDisabled}
            placeholder={placeholder}
            className="flex-1 font-mono text-sm"
          />
          {(allowEmpty || list.length > 1) && (
            <button
              type="button"
              className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => removeCommand(i, list, setter, allowEmpty)}
              disabled={configDisabled}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => addCommand(list, setter)}
        disabled={configDisabled}
      >
        <Plus className="h-3.5 w-3.5" />
        Add command
      </button>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 xl:p-6 space-y-6">
        {(projectError || configError) && (
          <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive" role="alert">
              Project settings unavailable:{" "}
              {projectError?.message ?? configError?.message ?? "Unknown error"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={detailReadRefreshing}
              onClick={() => void retryDetailReads()}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry reads
            </Button>
          </div>
        )}
        {/* ── General ── */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">General</h4>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            {/* Name */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">Name</span>
                <p className="text-sm text-muted-foreground">Display name for this project</p>
              </div>
              <div className="w-full min-w-0 xl:w-80">
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onBlur={handleNameBlur}
                  disabled={projectUnavailable || draft.nameSaving}
                  className="w-full"
                  placeholder="Project name"
                  aria-label="Project name"
                />
                {draft.nameError && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p role="alert" className="min-w-0 break-words text-sm text-destructive">
                      Name not saved: {draft.nameError}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleNameBlur}
                      disabled={projectUnavailable || draft.nameSaving}
                    >
                      Retry name
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Icon */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border">
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">Icon</span>
                <p className="text-sm text-muted-foreground">Project avatar in sidebar</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  className="relative h-10 w-10 rounded-lg border border-border overflow-hidden flex items-center justify-center cursor-pointer bg-muted group/icon"
                  onClick={() => uploadIconMutation.mutate({ id: projectId })}
                  disabled={projectUnavailable || uploadIconMutation.isPending}
                  title="Click to change icon"
                >
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <FolderOpen className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/icon:opacity-100 transition-opacity duration-150">
                    <ImageIcon className="h-4 w-4 text-white" />
                  </div>
                </button>
                {project?.iconPath && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeIconMutation.mutate({ id: projectId })}
                    disabled={projectUnavailable || removeIconMutation.isPending}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* Path */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border">
              <div className="flex-1 min-w-0 mr-4">
                <span className="text-sm font-medium text-foreground">Path</span>
                <p className="text-sm text-muted-foreground truncate">{project?.path || "-"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 flex-shrink-0 pl-2"
                onClick={handleOpenInFinder}
                disabled={!project?.path}
              >
                {getPlatform() === "darwin" ? (
                  <img src={finderIcon} alt="" className="h-3.5 w-3.5" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5" />
                )}
                {getFileManagerName()}
              </Button>
            </div>

            {/* Repository */}
            {project?.gitOwner && project?.gitRepo && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">Repository</span>
                  <p className="text-sm text-muted-foreground">
                    {project.gitOwner}/{project.gitRepo}
                  </p>
                </div>
                {project.gitProvider === "github" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 flex-shrink-0 pl-2"
                    onClick={() => {
                      window.open(
                        `https://github.com/${project.gitOwner}/${project.gitRepo}`,
                        "_blank",
                      )
                    }}
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                    GitHub
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Config ── */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Config</h4>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">Config file</span>
                <p className="text-sm text-muted-foreground">Where worktree setup is stored</p>
              </div>
              <Select
                value={saveTarget}
                onValueChange={(v) => {
                  setSaveTarget(v as "cursor" | "flapstack")
                  pendingSaveRef.current = true
                }}
                disabled={configDisabled}
              >
                <SelectTrigger className="max-w-full px-3" aria-label="Config file">
                  <span className="text-sm font-mono">
                    {saveTarget === "cursor"
                      ? ".cursor/worktrees.json"
                      : ".flapstack/worktree.json"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flapstack">.flapstack/worktree.json</SelectItem>
                  {cursorExists && <SelectItem value="cursor">.cursor/worktrees.json</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {(draft.configError ||
              draft.configSaving ||
              (draft.savedConfig !== null &&
                JSON.stringify(draft.config) !== draft.savedConfig)) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
                <p
                  role={draft.configError ? "alert" : "status"}
                  className={cn(
                    "min-w-0 break-words text-sm",
                    draft.configError ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {draft.configError
                    ? `Config not saved: ${draft.configError}`
                    : draft.configSaving
                      ? "Saving config..."
                      : "Config changes not saved yet."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={configDisabled}
                  onClick={doSave}
                >
                  {draft.configError ? "Retry config" : "Save config"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── Worktree ── */}
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <h4 className="text-sm font-medium text-foreground">Worktree</h4>
            <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
              <NewChatAgentProfileSelector
                scope="project"
                projectId={projectId}
                permissionMode="ask-before-edits"
                runtimePreference="auto"
                onSelectionChange={setFillProfileSelection}
              />
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => {
                  const prompt = COMMAND_PROMPTS["worktree-setup"]
                  if (prompt && projectId) {
                    const profile =
                      fillProfileSelection && !("invalid" in fillProfileSelection)
                        ? fillProfileSelection
                        : null
                    createChatMutation.mutate({
                      scope: "project",
                      projectId,
                      name: "Worktree Setup",
                      initialMessageParts: [{ type: "text", text: prompt }],
                      useWorktree: false,
                      mode: "write",
                      agentProfile: profile?.profile,
                      confirmedAgentProfileDigest: profile?.digest,
                      harness: profile?.harness,
                      model: profile?.model ?? undefined,
                      runtimePreference: profile?.runtimePreference,
                      permissionMode: profile?.permissionMode as
                        | "read-only"
                        | "ask-before-edits"
                        | "auto-edit-project-only"
                        | "full-access"
                        | undefined,
                    })
                  }
                }}
                disabled={
                  !projectId ||
                  createChatMutation.isPending ||
                  (fillProfileSelection !== null && "invalid" in fillProfileSelection)
                }
              >
                <AIPenIcon className="h-3.5 w-3.5" />
                Fill with AI
              </Button>
            </div>
          </div>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            {/* Setup commands */}
            <div className="p-4 space-y-3">
              <div>
                <span className="text-sm font-medium text-foreground">Setup Commands</span>
                <p className="text-sm text-muted-foreground">
                  Run after worktree creation.{" "}
                  <button
                    type="button"
                    className="font-mono text-xs bg-muted px-1 py-0.5 rounded hover:text-foreground transition-colors cursor-pointer"
                    onClick={() => {
                      navigator.clipboard.writeText("$ROOT_WORKTREE_PATH")
                      toast.success("Copied to clipboard")
                    }}
                    title="Click to copy"
                  >
                    $ROOT_WORKTREE_PATH
                  </button>{" "}
                  for main repo.
                </p>
              </div>
              {renderCommandList(
                commands,
                setCommands,
                "bun install && cp $ROOT_WORKTREE_PATH/.env .env",
              )}
            </div>

            {/* Platform overrides - macOS/Linux */}
            {(unixCommands.length > 0 || showPlatformSpecific) && (
              <div className="p-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">macOS / Linux</span>
                  {unixCommands.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      Falls back to commands above
                    </span>
                  )}
                </div>
                {renderCommandList(unixCommands, setUnixCommands, "brew install deps", true)}
              </div>
            )}

            {/* Platform overrides - Windows */}
            {(windowsCommands.length > 0 || showPlatformSpecific) && (
              <div className="p-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Windows</span>
                  {windowsCommands.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      Falls back to commands above
                    </span>
                  )}
                </div>
                {renderCommandList(windowsCommands, setWindowsCommands, "npm ci", true)}
              </div>
            )}

            {/* Add platform overrides link */}
            {!showPlatformSpecific && unixCommands.length === 0 && windowsCommands.length === 0 && (
              <div className="p-4 border-t border-border">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPlatformSpecific(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add platform-specific overrides
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Danger Zone ── */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Danger Zone</h4>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">Remove Project</span>
                <p className="text-sm text-muted-foreground">
                  Remove from your list. Files on disk will not be deleted.
                </p>
              </div>
              <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10"
                    disabled={projectUnavailable || deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove &quot;{project?.name}&quot; from your project list. Your
                      files will not be deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate({ id: projectId })}
                      disabled={deleteMutation.isPending}
                      className={buttonVariants({ variant: "destructive" })}
                    >
                      {deleteMutation.isPending ? "Removing..." : "Remove"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Main Two-Panel Component ---
export function AgentsProjectsTab() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  // Keep failed drafts and in-flight acknowledgements attached to their original project.
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({})
  const setDraft = useCallback<Dispatch<SetStateAction<ProjectDraft>>>(
    (update) => {
      if (!selectedProjectId) return
      setDrafts((current) => {
        const previous = current[selectedProjectId] ?? emptyDraft
        const next = typeof update === "function" ? update(previous) : update
        return next === previous ? current : { ...current, [selectedProjectId]: next }
      })
    },
    [selectedProjectId],
  )
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search on "/" hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const { data: projects, isLoading, isFetching, error, refetch } = trpc.projects.list.useQuery()

  const openFolderMutation = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        setSelectedProjectId(project.id)
      }
    },
    onError: (error) => {
      toast.error(`Failed to add project: ${error.message}`)
    },
  })

  // Filter projects by search
  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path?.toLowerCase().includes(q) ||
        p.gitRepo?.toLowerCase().includes(q),
    )
  }, [projects, searchQuery])

  const allProjectIds = useMemo(() => filteredProjects.map((p) => p.id), [filteredProjects])

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allProjectIds,
    selectedItem: selectedProjectId,
    onSelect: setSelectedProjectId,
  })

  // Auto-select first project
  useEffect(() => {
    if (selectedProjectId || isLoading) return
    if (projects && projects.length > 0) {
      setSelectedProjectId(projects[0]!.id)
    }
  }, [projects, selectedProjectId, isLoading])

  // Sync selection from global selectedProject (e.g., toast action)
  useEffect(() => {
    if (!selectedProject?.id) return
    setSelectedProjectId(selectedProject.id)
  }, [selectedProject?.id])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden xl:flex-row">
      {/* Left sidebar - project list */}
      <ResizableSidebar
        className="shrink-0 max-xl:!h-40 max-xl:!w-full max-xl:[&_.cursor-col-resize]:hidden"
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsProjectsSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div
          className="flex flex-col h-full bg-background border-r overflow-hidden"
          style={{ borderRightWidth: "0.5px" }}
        >
          {/* Search + Add */}
          <div className="px-2 pt-2 flex-shrink-0 flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              placeholder="Search projects..."
              aria-label="Search projects"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-none"
            />
            <button
              onClick={() => openFolderMutation.mutate()}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
              title="Add project folder"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {error && (
            <div className="mx-2 mt-2 flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="text-xs text-destructive" role="alert">
                Projects unavailable: {error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry
              </Button>
            </div>
          )}

          {/* Project list */}
          <div
            ref={listRef}
            onKeyDown={listKeyDown}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-none"
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <FolderFilledIcon className="h-5 w-5 text-muted-foreground animate-pulse" />
              </div>
            ) : error && !projects ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <FolderFilledIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">Project list unavailable</p>
                <p className="text-xs text-muted-foreground">
                  Retry discovery to determine which projects are registered.
                </p>
              </div>
            ) : !projects || projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <FolderFilledIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">No projects</p>
                <button
                  onClick={() => openFolderMutation.mutate()}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Add your first project
                </button>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">No results found</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredProjects.map((project) => {
                  const isSelected = selectedProjectId === project.id
                  return (
                    <button
                      key={project.id}
                      data-item-id={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={cn(
                        "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                        isSelected
                          ? "bg-foreground/5 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <ProjectIcon project={project} className="h-4 w-4" />
                        <span className="text-sm truncate flex-1">{project.name}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {selectedProjectId ? (
          <ProjectDetail
            key={selectedProjectId}
            projectId={selectedProjectId}
            draft={drafts[selectedProjectId] ?? emptyDraft}
            setDraft={setDraft}
          />
        ) : error && !projects ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <FolderFilledIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">Project list unavailable</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry discovery
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <FolderFilledIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">
              {projects && projects.length > 0
                ? "Select a project to view settings"
                : "No projects added yet"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Keep legacy export for backward compatibility
export const AgentsProjectWorktreeTab = AgentsProjectsTab
