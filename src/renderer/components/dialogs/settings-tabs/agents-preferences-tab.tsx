import { useAtom } from "jotai"
import { useEffect, useMemo, useState } from "react"
import {
  analyticsOptOutAtom,
  autoAdvanceTargetAtom,
  chatAutoTaggingConfidenceAtom,
  chatAutoTaggingEnabledAtom,
  chatTitleGenerationEnabledAtom,
  chatTitleStyleAtom,
  crossScopeMoveEnabledAtom,
  codexThreadVisibilityAtom,
  defaultAgentModeAtom,
  desktopNotificationsEnabledAtom,
  groupCloseBehaviorAtom,
  reasoningOutputEnabledAtom,
  notifyWhenFocusedAtom,
  newChatDraftReminderEnabledAtom,
  soundNotificationsEnabledAtom,
  preferredEditorAtom,
  type AgentMode,
  type AutoAdvanceTarget,
  type GroupCloseBehavior,
} from "../../../lib/atoms"
import type { ChatTitleStyle } from "../../../../shared/chat-metadata"
import type { CodexThreadVisibility } from "../../../../shared/codex-thread-visibility"
import { CHAT_MODES, CHAT_MODE_META } from "../../../../shared/chat-mode"
import { APP_META, type ExternalApp } from "../../../../shared/external-apps"
import { initAnalytics, shutdown as shutdownAnalytics } from "../../../lib/analytics"
import { toast } from "sonner"

// Editor icon imports
import cursorIcon from "../../../assets/app-icons/cursor.svg"
import vscodeIcon from "../../../assets/app-icons/vscode.svg"
import vscodeInsidersIcon from "../../../assets/app-icons/vscode-insiders.svg"
import zedIcon from "../../../assets/app-icons/zed.png"
import sublimeIcon from "../../../assets/app-icons/sublime.svg"
import xcodeIcon from "../../../assets/app-icons/xcode.svg"
import intellijIcon from "../../../assets/app-icons/intellij.svg"
import webstormIcon from "../../../assets/app-icons/webstorm.svg"
import pycharmIcon from "../../../assets/app-icons/pycharm.svg"
import phpstormIcon from "../../../assets/app-icons/phpstorm.svg"
import golandIcon from "../../../assets/app-icons/goland.svg"
import clionIcon from "../../../assets/app-icons/clion.svg"
import riderIcon from "../../../assets/app-icons/rider.svg"
import fleetIcon from "../../../assets/app-icons/fleet.svg"
import rustroverIcon from "../../../assets/app-icons/rustrover.svg"
import windsurfIcon from "../../../assets/app-icons/windsurf.svg"
import traeIcon from "../../../assets/app-icons/trae.svg"
import itermIcon from "../../../assets/app-icons/iterm.png"
import warpIcon from "../../../assets/app-icons/warp.png"
import terminalIcon from "../../../assets/app-icons/terminal.png"
import ghosttyIcon from "../../../assets/app-icons/ghostty.svg"

const EDITOR_ICONS: Partial<Record<ExternalApp, string>> = {
  cursor: cursorIcon,
  vscode: vscodeIcon,
  "vscode-insiders": vscodeInsidersIcon,
  zed: zedIcon,
  windsurf: windsurfIcon,
  sublime: sublimeIcon,
  xcode: xcodeIcon,
  trae: traeIcon,
  iterm: itermIcon,
  warp: warpIcon,
  terminal: terminalIcon,
  ghostty: ghosttyIcon,
  intellij: intellijIcon,
  webstorm: webstormIcon,
  pycharm: pycharmIcon,
  phpstorm: phpstormIcon,
  goland: golandIcon,
  clion: clionIcon,
  rider: riderIcon,
  fleet: fleetIcon,
  rustrover: rustroverIcon,
}

interface EditorOption {
  id: ExternalApp
  label: string
}

// Order matches Superset: editors, terminals, VS Code, JetBrains
const EDITORS: EditorOption[] = [
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "sublime", label: "Sublime Text" },
  { id: "xcode", label: "Xcode" },
  { id: "windsurf", label: "Windsurf" },
  { id: "trae", label: "Trae" },
]

const TERMINALS: EditorOption[] = [
  { id: "iterm", label: "iTerm" },
  { id: "warp", label: "Warp" },
  { id: "terminal", label: "Terminal" },
  { id: "ghostty", label: "Ghostty" },
]

const VSCODE: EditorOption[] = [
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
]

const JETBRAINS: EditorOption[] = [
  { id: "intellij", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
  { id: "pycharm", label: "PyCharm" },
  { id: "phpstorm", label: "PhpStorm" },
  { id: "goland", label: "GoLand" },
  { id: "clion", label: "CLion" },
  { id: "rider", label: "Rider" },
  { id: "fleet", label: "Fleet" },
  { id: "rustrover", label: "RustRover" },
]
import vscodeBaseIcon from "../../../assets/app-icons/vscode.svg"
import jetbrainsBaseIcon from "../../../assets/app-icons/jetbrains.svg"
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { ChevronDown } from "lucide-react"
import { Switch } from "../../ui/switch"
import { trpc } from "../../../lib/trpc"
import { startProductTour } from "../../../features/onboarding/product-tour"
import { useIsNarrowScreen } from "./use-is-narrow-screen"

export function AgentsPreferencesTab() {
  const trpcUtils = trpc.useUtils()
  const [reasoningOutputEnabled, setReasoningOutputEnabled] = useAtom(reasoningOutputEnabledAtom)
  const [chatTitleGenerationEnabled, setChatTitleGenerationEnabled] = useAtom(
    chatTitleGenerationEnabledAtom,
  )
  const [chatTitleStyle, setChatTitleStyle] = useAtom(chatTitleStyleAtom)
  const [chatAutoTaggingEnabled, setChatAutoTaggingEnabled] = useAtom(chatAutoTaggingEnabledAtom)
  const [chatAutoTaggingConfidence, setChatAutoTaggingConfidence] = useAtom(
    chatAutoTaggingConfidenceAtom,
  )
  const [soundEnabled, setSoundEnabled] = useAtom(soundNotificationsEnabledAtom)
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useAtom(
    desktopNotificationsEnabledAtom,
  )
  const [notifyWhenFocused, setNotifyWhenFocused] = useAtom(notifyWhenFocusedAtom)
  const [analyticsOptOut, setAnalyticsOptOut] = useAtom(analyticsOptOutAtom)
  const [autoAdvanceTarget, setAutoAdvanceTarget] = useAtom(autoAdvanceTargetAtom)
  const [crossScopeMoveEnabled, setCrossScopeMoveEnabled] = useAtom(crossScopeMoveEnabledAtom)
  const [groupCloseBehavior, setGroupCloseBehavior] = useAtom(groupCloseBehaviorAtom)
  const [newChatDraftReminderEnabled, setNewChatDraftReminderEnabled] = useAtom(
    newChatDraftReminderEnabledAtom,
  )
  const [defaultAgentMode, setDefaultAgentMode] = useAtom(defaultAgentModeAtom)
  const [codexThreadVisibility, setCodexThreadVisibility] = useAtom(codexThreadVisibilityAtom)
  const [preferredEditor, setPreferredEditor] = useAtom(preferredEditorAtom)
  const isNarrowScreen = useIsNarrowScreen()
  const { data: availableAppsResult } = trpc.external.listAvailableApps.useQuery()
  const availableAppIds = useMemo(
    () => new Set<ExternalApp>(availableAppsResult?.apps ?? []),
    [availableAppsResult?.apps],
  )
  const availableEditors = EDITORS.filter((app) => availableAppIds.has(app.id))
  const availableTerminals = TERMINALS.filter((app) => availableAppIds.has(app.id))
  const availableVsCode = VSCODE.filter((app) => availableAppIds.has(app.id))
  const availableJetBrains = JETBRAINS.filter((app) => availableAppIds.has(app.id))
  const detectedApps = [
    ...availableEditors,
    ...availableTerminals,
    ...availableVsCode,
    ...availableJetBrains,
  ]
  const effectivePreferredEditor = availableAppIds.has(preferredEditor)
    ? preferredEditor
    : detectedApps[0]?.id
  const { data: runtimeActivityFixtureSettings } =
    trpc.debug.getRuntimeActivityFixtureSettings.useQuery()
  const setRuntimeActivityFixtureSettings =
    trpc.debug.setRuntimeActivityFixtureSettings.useMutation({
      onSuccess: (settings) => {
        trpcUtils.debug.getRuntimeActivityFixtureSettings.setData(undefined, settings)
      },
    })

  useEffect(() => {
    let mounted = true
    const removeConsentListener = window.desktopApi?.onAnalyticsConsentChanged((consentGranted) => {
      if (mounted) setAnalyticsOptOut(!consentGranted)
    })
    window.desktopApi
      ?.getAnalyticsConsent()
      .then((consentGranted) => {
        if (mounted) setAnalyticsOptOut(!consentGranted)
      })
      .catch(() => {
        if (mounted) setAnalyticsOptOut(true)
      })
    return () => {
      mounted = false
      removeConsentListener?.()
    }
  }, [setAnalyticsOptOut])

  // Co-authored-by setting from Claude settings.json
  const { data: includeCoAuthoredBy, refetch: refetchCoAuthoredBy } =
    trpc.claudeSettings.getIncludeCoAuthoredBy.useQuery()
  const setCoAuthoredByMutation = trpc.claudeSettings.setIncludeCoAuthoredBy.useMutation({
    onSuccess: () => {
      refetchCoAuthoredBy()
    },
  })

  const handleCoAuthoredByToggle = (enabled: boolean) => {
    setCoAuthoredByMutation.mutate({ enabled })
  }

  // Sync opt-out status to main process
  const handleAnalyticsToggle = async (optedOut: boolean) => {
    setAnalyticsOptOut(optedOut)
    if (optedOut) await shutdownAnalytics()

    try {
      await window.desktopApi?.setAnalyticsOptOut(optedOut)
      if (!optedOut) await initAnalytics()
    } catch (error) {
      const consentGranted = await window.desktopApi?.getAnalyticsConsent().catch(() => false)
      setAnalyticsOptOut(consentGranted !== true)
      if (consentGranted === true) {
        await initAnalytics()
      } else {
        await shutdownAnalytics()
      }
      toast.error("Could not save analytics preference", {
        description:
          "The switch reflects the current session. Retry before restarting to save this choice.",
      })
      console.error("Failed to sync analytics opt-out to main process:", error)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Preferences</h3>
          <p className="text-xs text-muted-foreground">
            Configure shared agent behavior and app preferences
          </p>
        </div>
      )}

      {/* Agent Behavior */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div
          className="flex items-center justify-between p-4 outline-none"
          data-settings-id="preferences-unsent-draft-reminders"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Unsent draft reminders</span>
            <span className="text-xs text-muted-foreground">
              Show the number of saved drafts when starting another chat for the same project.
            </span>
          </div>
          <Switch
            checked={newChatDraftReminderEnabled}
            onCheckedChange={setNewChatDraftReminderEnabled}
          />
        </div>
        <div
          className="flex items-center justify-between border-t border-border p-4 outline-none"
          data-settings-id="preferences-chat-titles"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Automatic chat titles</span>
            <span className="text-xs text-muted-foreground">
              Summarize the first message instead of using it verbatim.
            </span>
          </div>
          <Switch
            checked={chatTitleGenerationEnabled}
            onCheckedChange={setChatTitleGenerationEnabled}
          />
        </div>
        <div
          className="flex items-center justify-between border-t border-border p-4 outline-none"
          data-settings-id="preferences-chat-title-detail"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Chat title detail</span>
            <span className="text-xs text-muted-foreground">
              Choose how much context automatic titles include.
            </span>
          </div>
          <Select
            value={chatTitleStyle}
            onValueChange={(value: ChatTitleStyle) => setChatTitleStyle(value)}
            disabled={!chatTitleGenerationEnabled}
          >
            <SelectTrigger className="w-auto min-w-28 px-2">
              <span className="text-xs">
                {chatTitleStyle === "concise"
                  ? "Concise"
                  : chatTitleStyle === "balanced"
                    ? "Balanced"
                    : "Descriptive"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concise">Concise, up to 5 words</SelectItem>
              <SelectItem value="balanced">Balanced, up to 8 words</SelectItem>
              <SelectItem value="descriptive">Descriptive, up to 12 words</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex items-center justify-between border-t border-border p-4 outline-none"
          data-settings-id="preferences-chat-auto-tags"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Automatic chat tags</span>
            <span className="text-xs text-muted-foreground">
              Add short user tags and separate agent-only role labels when the first message is
              clear.
            </span>
          </div>
          <Switch checked={chatAutoTaggingEnabled} onCheckedChange={setChatAutoTaggingEnabled} />
        </div>
        <div
          className="flex items-center justify-between gap-6 border-t border-border p-4 outline-none"
          data-settings-id="preferences-chat-tag-confidence"
          tabIndex={-1}
        >
          <div className="flex min-w-0 flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Automatic tag confidence</span>
            <span className="text-xs text-muted-foreground">
              Higher values create fewer, more certain tags and agent labels.
            </span>
          </div>
          <div className="flex w-44 shrink-0 items-center gap-3">
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              value={chatAutoTaggingConfidence}
              onChange={(event) => setChatAutoTaggingConfidence(Number(event.target.value))}
              disabled={!chatAutoTaggingEnabled}
              aria-label="Automatic tag confidence"
              className="min-w-0 flex-1 accent-primary disabled:opacity-50"
            />
            <span className="w-9 text-right text-xs tabular-nums text-foreground">
              {chatAutoTaggingConfidence}%
            </span>
          </div>
        </div>
        <div
          className="flex items-center justify-between border-t border-border p-4 outline-none"
          data-settings-id="preferences-reasoning"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Reasoning output</span>
            <span className="text-xs text-muted-foreground">
              Show deeper model reasoning output (uses more credits).{" "}
              <span className="text-foreground/70">Disables response streaming.</span>
            </span>
          </div>
          <Switch checked={reasoningOutputEnabled} onCheckedChange={setReasoningOutputEnabled} />
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-default-mode"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Default chat mode</span>
            <span className="text-xs text-muted-foreground">
              How new chats should work by default
            </span>
          </div>
          <Select
            value={defaultAgentMode}
            onValueChange={(value: AgentMode) => setDefaultAgentMode(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">{CHAT_MODE_META[defaultAgentMode].label}</span>
            </SelectTrigger>
            <SelectContent>
              {CHAT_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {CHAT_MODE_META[mode].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-coauthor"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Claude commit attribution</span>
            <span className="text-xs text-muted-foreground">
              Add a Claude Co-authored-by trailer to commits made by Claude Code
            </span>
          </div>
          <Switch
            checked={includeCoAuthoredBy ?? false}
            onCheckedChange={handleCoAuthoredByToggle}
            disabled={setCoAuthoredByMutation.isPending}
          />
        </div>
        <div
          className="flex items-center justify-between gap-6 border-t border-border p-4 outline-none"
          data-settings-id="preferences-codex-task-visibility"
          tabIndex={-1}
        >
          <div className="flex min-w-0 flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Codex task visibility</span>
            <span className="text-xs text-muted-foreground">
              Hide completed Flapstack tasks from active Codex lists, or keep them under their
              project.
            </span>
          </div>
          <Select
            value={codexThreadVisibility}
            onValueChange={(value: CodexThreadVisibility) => setCodexThreadVisibility(value)}
          >
            <SelectTrigger className="w-auto min-w-36 shrink-0 px-2">
              <span className="text-xs">
                {codexThreadVisibility === "hidden" ? "Hidden while idle" : "Show under project"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hidden">Hidden while idle</SelectItem>
              <SelectItem value="project">Show under project</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div
          className="flex items-center justify-between p-4 outline-none"
          data-settings-id="preferences-desktop-notifications"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Desktop Notifications</span>
            <span className="text-xs text-muted-foreground">
              Show system notifications when agent needs input or completes work
            </span>
          </div>
          <Switch
            checked={desktopNotificationsEnabled}
            onCheckedChange={setDesktopNotificationsEnabled}
          />
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-sound-notifications"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Sound Notifications</span>
            <span className="text-xs text-muted-foreground">
              Play a sound when agent completes work while you're away
            </span>
          </div>
          <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-focused-notifications"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Notify When Focused</span>
            <span className="text-xs text-muted-foreground">
              Show notifications even when the app window is active
            </span>
          </div>
          <Switch
            checked={notifyWhenFocused}
            onCheckedChange={setNotifyWhenFocused}
            disabled={!desktopNotificationsEnabled}
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div
          className="flex items-center justify-between gap-6 p-4 outline-none"
          data-settings-id="preferences-group-close"
          tabIndex={-1}
        >
          <div className="flex min-w-0 flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">When closing a group</span>
            <span className="text-xs text-muted-foreground">
              Ask first, keep its Chats on the main bar, or close every Chat in the group.
            </span>
          </div>
          <Select
            value={groupCloseBehavior}
            onValueChange={(value: GroupCloseBehavior) => setGroupCloseBehavior(value)}
          >
            <SelectTrigger className="w-auto min-w-40 shrink-0 px-2">
              <span className="text-xs">
                {groupCloseBehavior === "ask"
                  ? "Ask every time"
                  : groupCloseBehavior === "keep-chats"
                    ? "Keep Chats on main bar"
                    : "Close all Chats"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">Ask every time</SelectItem>
              <SelectItem value="keep-chats">Keep Chats on main bar</SelectItem>
              <SelectItem value="close-chats">Close all Chats</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex items-center justify-between border-t border-border p-4 outline-none"
          data-settings-id="preferences-drag-chats"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Drag chats between sections</span>
            <span className="text-xs text-muted-foreground">
              Allow dragging chats between Global, project, and task sections.
            </span>
          </div>
          <Switch checked={crossScopeMoveEnabled} onCheckedChange={setCrossScopeMoveEnabled} />
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-auto-advance"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Auto-advance</span>
            <span className="text-xs text-muted-foreground">
              Where to go after archiving a chat
            </span>
          </div>
          <Select
            value={autoAdvanceTarget}
            onValueChange={(value: AutoAdvanceTarget) => setAutoAdvanceTarget(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {autoAdvanceTarget === "next"
                  ? "Go to next chat"
                  : autoAdvanceTarget === "previous"
                    ? "Go to previous chat"
                    : "Close chat"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next">Go to next chat</SelectItem>
              <SelectItem value="previous">Go to previous chat</SelectItem>
              <SelectItem value="close">Close chat</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex items-center justify-between p-4 border-t border-border outline-none"
          data-settings-id="preferences-editor"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Preferred Editor</span>
            <span className="text-xs text-muted-foreground">
              Default app for opening project folders
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!effectivePreferredEditor}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {effectivePreferredEditor && EDITOR_ICONS[effectivePreferredEditor] && (
                  <img
                    src={EDITOR_ICONS[effectivePreferredEditor]}
                    alt=""
                    className="h-4 w-4 flex-shrink-0"
                  />
                )}
                <span className="truncate">
                  {effectivePreferredEditor
                    ? APP_META[effectivePreferredEditor].label
                    : "No editor detected"}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {availableEditors.map((editor) => (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => setPreferredEditor(editor.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[editor.id] ? (
                    <img
                      src={EDITOR_ICONS[editor.id]}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{editor.label}</span>
                </DropdownMenuItem>
              ))}
              {availableTerminals.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  onClick={() => setPreferredEditor(app.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[app.id] ? (
                    <img
                      src={EDITOR_ICONS[app.id]}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{app.label}</span>
                </DropdownMenuItem>
              ))}
              {availableVsCode.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2">
                    <img
                      src={vscodeBaseIcon}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                    <span>VS Code</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48" sideOffset={6} alignOffset={-4}>
                    {availableVsCode.map((app) => (
                      <DropdownMenuItem
                        key={app.id}
                        onClick={() => setPreferredEditor(app.id)}
                        className="flex items-center gap-2"
                      >
                        {EDITOR_ICONS[app.id] ? (
                          <img
                            src={EDITOR_ICONS[app.id]}
                            alt=""
                            className="h-4 w-4 flex-shrink-0 object-contain"
                          />
                        ) : (
                          <div className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span>{app.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {availableJetBrains.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2">
                    <img
                      src={jetbrainsBaseIcon}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                    <span>JetBrains</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="w-48 max-h-[300px] overflow-y-auto"
                    sideOffset={6}
                    alignOffset={-4}
                  >
                    {availableJetBrains.map((app) => (
                      <DropdownMenuItem
                        key={app.id}
                        onClick={() => setPreferredEditor(app.id)}
                        className="flex items-center gap-2"
                      >
                        {EDITOR_ICONS[app.id] ? (
                          <img
                            src={EDITOR_ICONS[app.id]}
                            alt=""
                            className="h-4 w-4 flex-shrink-0 object-contain"
                          />
                        ) : (
                          <div className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span>{app.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Help */}
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div
          className="flex items-center justify-between gap-6 p-4 outline-none"
          data-settings-id="preferences-product-tour"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Main-page tutorial</span>
            <span className="text-xs text-muted-foreground">
              Review the projects, chats, models, runtimes, modes, and settings controls.
            </span>
          </div>
          <button
            type="button"
            onClick={() => startProductTour()}
            className="h-8 shrink-0 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Run tutorial
          </button>
        </div>
      </div>

      {/* Developer testing */}
      {runtimeActivityFixtureSettings?.available && (
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div
            className="flex items-center justify-between gap-6 p-4 outline-none"
            data-settings-id="preferences-runtime-activity-fixtures"
            tabIndex={-1}
          >
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-foreground">
                Runtime activity test controls
              </span>
              <span className="text-xs text-muted-foreground">
                Show controls that create provider-free test runs in project chats.
              </span>
            </div>
            <Switch
              checked={runtimeActivityFixtureSettings?.enabled ?? false}
              onCheckedChange={(enabled) => setRuntimeActivityFixtureSettings.mutate({ enabled })}
              disabled={
                runtimeActivityFixtureSettings === undefined ||
                setRuntimeActivityFixtureSettings.isPending
              }
            />
          </div>
        </div>
      )}

      {/* Privacy */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div
          className="flex items-center justify-between gap-6 p-4 outline-none"
          data-settings-id="preferences-analytics"
          tabIndex={-1}
        >
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Share Usage Analytics</span>
            <span className="text-xs text-muted-foreground">
              Help us improve Flapstack by sharing optional product usage and app performance data.
              We never send your code, prompts, or messages, and do not use this data for AI
              training.
            </span>
          </div>
          <Switch
            checked={!analyticsOptOut}
            onCheckedChange={(enabled) => handleAnalyticsToggle(!enabled)}
          />
        </div>
      </div>
    </div>
  )
}
