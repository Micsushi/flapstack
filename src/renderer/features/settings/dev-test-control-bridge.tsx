import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  billingMethodAtom,
  ctrlTabTargetAtom,
  customHotkeysAtom,
  getReleasedCtrlTabTarget,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
} from "../../lib/atoms"
import { buildShortcutState, mutateShortcutConfig } from "../../lib/hotkeys"
import { appStore } from "../../lib/jotai-store"
import { controlStage6ElectronMeasurement } from "../../lib/stage6-electron-performance-control"
import { trpc } from "../../lib/trpc"
import {
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedProjectAtom,
  pendingUserQuestionsAtom,
} from "../agents/atoms"
import { readRendererOrchestrationCard } from "../agents/lib/orchestration-test-state"
import {
  getAgentSubChatStore,
  getMountedAgentSubChatStore,
  useAgentSubChatStore,
} from "../agents/stores/sub-chat-store"
import { invokePermissionUiTestControl } from "../agents/lib/permission-ui-test-control"
import {
  detailsSidebarOpenAtom,
  detailsSidebarTabAtom,
  productMcpAuditOpenChatIdsAtom,
  unifiedSidebarEnabledAtom,
  widgetVisibilityAtomFamily,
} from "../details-sidebar/atoms"
import { SETTINGS_TAB_REGISTRY, normalizeVisibleSettingsTab } from "./settings-visibility"
import {
  chatBelongsToProject,
  refreshDevChatUntilVisible,
  refreshDevSelectionSnapshot,
  validateDevChatSelectionSnapshot,
} from "./dev-test-selection-refresh"

function boundedCarryoverDataset(
  element: HTMLElement,
  surface: "voice" | "usage" | "reasoning" | "run-change",
) {
  const data = element.dataset
  if (surface === "voice") {
    return {
      sttAdapter: data.sttAdapter,
      ttsAdapter: data.ttsAdapter,
      historyCount: data.historyCount,
    }
  }
  if (surface === "usage") {
    return {
      providerStateCount: data.providerStateCount,
      currentSampleCount: data.currentSampleCount,
      refreshing: data.refreshing,
      daemonHealth: data.daemonHealth,
    }
  }
  if (surface === "reasoning") {
    return {
      expanded: data.expanded,
      streaming: data.streaming,
      label: data.label,
      status: data.status,
    }
  }
  return {
    runId: data.runId,
    expanded: data.expanded,
    reviewOpen: data.reviewOpen,
    undone: data.undone,
    fileCount: data.fileCount,
  }
}

function readUsageUiState(document: Document) {
  const root = document.querySelector<HTMLElement>('[data-dev-carryover-surface="usage"]')
  const pressedValue = (control: string) =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`[data-dev-usage-control="${control}"]`),
    ).find(
      (element) =>
        element.getAttribute("aria-pressed") === "true" || element.dataset.state === "active",
    )?.dataset.value ?? null
  const monitoring = document.querySelector<HTMLDetailsElement>(
    '[data-dev-usage-control="monitoring"]',
  )
  return {
    mounted: Boolean(root),
    provider: pressedValue("provider"),
    scope: pressedValue("scope"),
    historyMode: pressedValue("history-mode"),
    historyRange: pressedValue("history-range"),
    monitoringOpen: monitoring?.open ?? false,
    rows: Object.fromEntries(
      (["alerts", "samples", "cycles"] as const).map((kind) => [
        kind,
        document.querySelectorAll(`[data-dev-usage-row="${kind}"]`).length,
      ]),
    ),
    showAllTargets: Array.from(
      document.querySelectorAll<HTMLElement>('[data-dev-usage-action="show-all"]'),
    ).map((element) => element.dataset.devUsagePaging),
  }
}

const DEV_VOICE_UI_TEXT = "Stage 3 voice history fixture"

function readVoiceUiState(document: Document, historyId?: string) {
  const root = document.querySelector<HTMLElement>('[data-dev-carryover-surface="voice"]')
  const activeElement = document.activeElement as HTMLElement | null
  const controlValue = (name: string) =>
    document.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-dev-voice-control="${name}"]`,
    )?.value ?? null
  return {
    mounted: Boolean(root),
    sttAdapterId: controlValue("stt-adapter"),
    ttsAdapterId: controlValue("tts-adapter"),
    voiceId: controlValue("voice"),
    rate: controlValue("rate"),
    searchActive: Boolean(controlValue("history-search")),
    previewHasText: Boolean(controlValue("preview-text")),
    activeComposerHasFixtureText:
      activeElement?.getAttribute("contenteditable") === "true"
        ? activeElement.textContent?.includes(DEV_VOICE_UI_TEXT) === true
        : false,
    visibleComposerFixtureMatches: Array.from(
      document.querySelectorAll<HTMLElement>('[contenteditable="true"]'),
    )
      .filter((element) => element.offsetParent !== null)
      .slice(0, 20)
      .filter((element) => element.textContent?.includes(DEV_VOICE_UI_TEXT) === true).length,
    history: Array.from(document.querySelectorAll<HTMLElement>("[data-dev-voice-history-id]"))
      .filter((element) => element.dataset.devVoiceHistoryId === historyId)
      .slice(0, 100)
      .map((element) => ({
        id: element.dataset.devVoiceHistoryId,
        kind: element.dataset.devVoiceHistoryKind,
        containsFixtureText: element.textContent?.includes(DEV_VOICE_UI_TEXT) === true,
        actions: Array.from(element.querySelectorAll<HTMLElement>("[data-dev-voice-action]"))
          .map((action) => action.dataset.devVoiceAction)
          .filter(Boolean),
      })),
  }
}

/** Always-mounted renderer half of the authenticated development test-control bridge. */
export function DevTestControlBridge() {
  const trpcUtils = trpc.useUtils()

  useEffect(() => {
    if (!window.desktopApi?.onDevRendererControlRequest) return
    return window.desktopApi.onDevRendererControlRequest(async (request) => {
      const desktopView = appStore.get(desktopViewAtom)
      const settingsActiveTab = appStore.get(agentsSettingsDialogActiveTabAtom)
      const settingsSearchQuery = appStore.get(settingsSearchQueryAtom)
      const settingsSearchTarget = appStore.get(settingsSearchTargetAtom)
      const selectedProject = appStore.get(selectedProjectAtom)
      const settingsState = {
        settingsOpen: desktopView === "settings",
        activeTab: normalizeVisibleSettingsTab(settingsActiveTab),
        searchQuery: settingsSearchQuery,
        searchTarget: settingsSearchTarget,
        selectedProject,
      }
      const legacyState = () => ({
        rawActiveTab: appStore.get(agentsSettingsDialogActiveTabAtom),
        normalizedActiveTab: normalizeVisibleSettingsTab(
          appStore.get(agentsSettingsDialogActiveTabAtom),
        ),
        storedCtrlTabTarget: appStore.get(ctrlTabTargetAtom),
        effectiveCtrlTabTarget: getReleasedCtrlTabTarget(),
      })
      if (request.command === "performance.measure") {
        try {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: await controlStage6ElectronMeasurement(request),
          })
        } catch (error) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Electron performance control failed",
          })
        }
        return
      }
      if (request.command === "settings.get") {
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: settingsState,
        })
        return
      }
      if (request.command === "settings.legacy.get") {
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: legacyState(),
        })
        return
      }
      if (request.command === "settings.legacy.mutate") {
        const previous = legacyState()
        if (request.activeTab !== undefined) {
          const tab = SETTINGS_TAB_REGISTRY.find((entry) => entry.id === request.activeTab)?.id
          if (!tab) {
            window.desktopApi.respondDevRendererControl({
              requestId: request.requestId,
              ok: false,
              error: "Unknown Settings tab",
            })
            return
          }
          appStore.set(agentsSettingsDialogActiveTabAtom, tab)
        }
        if (request.ctrlTabTarget !== undefined) {
          appStore.set(ctrlTabTargetAtom, request.ctrlTabTarget)
        }
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: { previous, current: legacyState() },
        })
        return
      }
      if (request.command === "settings.control") {
        let nextState = settingsState
        if (request.operation === "open") {
          appStore.set(agentsSettingsDialogOpenAtom, true)
          nextState = { ...nextState, settingsOpen: true }
        } else if (request.operation === "close") {
          appStore.set(agentsSettingsDialogOpenAtom, false)
          nextState = { ...nextState, settingsOpen: false }
        } else if (request.operation === "navigate") {
          const requestedTab = SETTINGS_TAB_REGISTRY.find((entry) => entry.id === request.tab)?.id
          const activeTab = normalizeVisibleSettingsTab(requestedTab ?? "preferences")
          appStore.set(agentsSettingsDialogActiveTabAtom, activeTab)
          appStore.set(settingsSearchTargetAtom, request.targetId ?? null)
          appStore.set(agentsSettingsDialogOpenAtom, true)
          nextState = {
            ...nextState,
            settingsOpen: true,
            activeTab,
            searchTarget: request.targetId ?? null,
          }
        } else if (request.operation === "search") {
          const query = request.query ?? ""
          appStore.set(settingsSearchQueryAtom, query)
          appStore.set(agentsSettingsDialogOpenAtom, true)
          nextState = { ...nextState, settingsOpen: true, searchQuery: query }
        } else {
          const snapshot = await refreshDevSelectionSnapshot({
            invalidateProjects: () => trpcUtils.projects.list.invalidate(),
            fetchProjects: () => trpcUtils.projects.list.fetch(),
            invalidateChats: () => trpcUtils.chats.list.invalidate(),
            fetchChats: () => trpcUtils.chats.list.fetch({}),
          })
          if (
            request.project &&
            !snapshot.projects.some((project) => project.id === request.project?.id)
          ) {
            window.desktopApi.respondDevRendererControl({
              requestId: request.requestId,
              ok: false,
              error: "Selected project is no longer active",
            })
            return
          }
          const selectedChatId = appStore.get(selectedAgentChatIdAtom)
          if (!chatBelongsToProject(snapshot.chats, selectedChatId, request.project?.id ?? null)) {
            appStore.set(selectedAgentChatIdAtom, null)
            appStore.set(selectedChatIsRemoteAtom, false)
            useAgentSubChatStore.getState().setChatId(null)
          }
          appStore.set(selectedProjectAtom, request.project ?? null)
          nextState = {
            ...nextState,
            selectedProject: request.project ?? null,
          }
        }
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: nextState,
        })
        return
      }
      if (request.command === "chat.select") {
        try {
          if (request.prepareStage6PerformanceProfile) {
            appStore.set(billingMethodAtom, "local-only")
          }
          const snapshot = await refreshDevSelectionSnapshot(
            {
              invalidateProjects: () => trpcUtils.projects.list.invalidate(),
              fetchProjects: () => trpcUtils.projects.list.fetch(),
              invalidateChats: () => trpcUtils.chats.list.invalidate(),
              fetchChats: () => trpcUtils.chats.list.fetch({}),
              invalidateChat: (chatId) => trpcUtils.chats.get.invalidate({ id: chatId }),
              fetchChat: (chatId) => trpcUtils.chats.get.fetch({ id: chatId }),
            },
            request.chatId,
          )
          validateDevChatSelectionSnapshot(snapshot, request.project.id, request.chatId)
          const persistedMessages = request.persistedMessages
          const compatibilityStore = getAgentSubChatStore().getState()
          compatibilityStore.setChatId(null)
          compatibilityStore.queueNavigation(request.chatId, request.subChatId)
          appStore.set(selectedProjectAtom, request.project)
          appStore.set(selectedAgentChatIdAtom, request.chatId)
          appStore.set(selectedChatIsRemoteAtom, false)
          appStore.set(openAgentChatIdsAtom, (current) =>
            current.includes(request.chatId) ? current : [...current, request.chatId],
          )
          appStore.set(agentsSettingsDialogOpenAtom, false)
          if (request.showOrchestration) {
            appStore.set(detailsSidebarOpenAtom, true)
            appStore.set(detailsSidebarTabAtom, "details")
            const visibilityAtom = widgetVisibilityAtomFamily(request.chatId)
            const visibleWidgets = appStore.get(visibilityAtom)
            if (!visibleWidgets.includes("orchestration")) {
              appStore.set(visibilityAtom, ["orchestration", ...visibleWidgets])
            }
          }

          await refreshDevChatUntilVisible(
            {
              chatId: request.chatId,
              subChatId: request.subChatId,
              messages: persistedMessages,
            },
            {
              timeoutMs: 15_000,
              now: () => performance.now(),
              nextFrame: () =>
                new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
              prepareSelection: () => {
                const mountedStore = getMountedAgentSubChatStore(request.chatId)
                if (!mountedStore) return
                const mountedState = mountedStore.getState()
                if (mountedState.chatId !== request.chatId) {
                  mountedState.queueNavigation(request.chatId, request.subChatId)
                  mountedState.setChatId(request.chatId)
                }
                mountedStore.getState().queueNavigation(request.chatId, request.subChatId)
              },
              dispatchRefresh: (detail) =>
                window.dispatchEvent(new CustomEvent("flapstack-dev-chat-refresh", { detail })),
              readVisibleState: () => {
                const groups = Array.from(
                  document.querySelectorAll<HTMLElement>("[data-chat-group][data-active-chat-id]"),
                )
                const group = groups.find(
                  (element) => element.dataset.activeChatId === request.chatId,
                )
                const transcript =
                  group?.querySelector<HTMLElement>(
                    "[data-chat-container][data-active-sub-chat-id]",
                  ) ?? null
                const mountedState = getMountedAgentSubChatStore(request.chatId)?.getState()
                return {
                  chatId: group?.dataset.activeChatId ?? (mountedState ? request.chatId : ""),
                  subChatId:
                    transcript?.dataset.activeSubChatId ?? mountedState?.activeSubChatId ?? "",
                  messageCount: transcript
                    ? Number(transcript.dataset.stage6PerformanceMessageCount)
                    : -1,
                  details: {
                    selectedChatId: appStore.get(selectedAgentChatIdAtom),
                    workbenchChatIds: groups.map((element) => element.dataset.activeChatId ?? ""),
                    mountedStoreChatId: mountedState?.chatId ?? null,
                    mountedOpenSubChatIds: mountedState?.openSubChatIds ?? [],
                    transcriptMounted: Boolean(transcript),
                  },
                }
              },
            },
          )

          const selectedSubChatId =
            getMountedAgentSubChatStore(request.chatId)?.getState().activeSubChatId ?? null
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: {
              chatId: appStore.get(selectedAgentChatIdAtom),
              subChatId: selectedSubChatId,
              selectedProject: request.project,
              settingsOpen: false,
              detailsOpen: appStore.get(detailsSidebarOpenAtom),
              detailsTab: appStore.get(detailsSidebarTabAtom),
              persistedMessageCount: persistedMessages.length,
            },
          })
        } catch (error) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Chat selection failed",
          })
        }
        return
      }
      if (request.command === "chat.copy") {
        if (appStore.get(selectedAgentChatIdAtom) !== request.chatId) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: "Requested chat is not selected",
          })
          return
        }
        const previousClipboard = await window.desktopApi.clipboardRead()
        const sentinel = `flapstack-dev-copy-${crypto.randomUUID()}`
        let copiedState:
          | {
              chatId: string
              source: "active-header" | "sidebar-menu"
              copied: boolean
              clipboardLength: number
              containsExpected: boolean
            }
          | undefined
        let operationError: unknown
        try {
          await window.desktopApi.clipboardWrite(sentinel)
          let action: HTMLElement | undefined
          if (request.source === "active-header") {
            action = Array.from(
              document.querySelectorAll<HTMLElement>('[data-dev-chat-copy-source="active-header"]'),
            ).find((element) => element.dataset.chatId === request.chatId)
          } else {
            const row = Array.from(
              document.querySelectorAll<HTMLElement>("[data-chat-item][data-chat-id]"),
            ).find((element) => element.dataset.chatId === request.chatId)
            if (row) {
              const rect = row.getBoundingClientRect()
              row.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: rect.left + Math.min(20, rect.width / 2),
                  clientY: rect.top + Math.min(20, rect.height / 2),
                }),
              )
              await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => window.setTimeout(resolve, 50)),
              )
              action = Array.from(
                document.querySelectorAll<HTMLElement>(
                  '[data-dev-chat-copy-source="sidebar-menu"]',
                ),
              ).find((element) => element.dataset.chatId === request.chatId)
            }
          }
          if (!action) throw new Error("Requested chat copy action is not mounted")
          action.click()

          let copiedText = sentinel
          for (let attempt = 0; attempt < 20 && copiedText === sentinel; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 100))
            copiedText = await window.desktopApi.clipboardRead()
          }
          copiedState = {
            chatId: request.chatId,
            source: request.source,
            copied: copiedText !== sentinel,
            clipboardLength: copiedText === sentinel ? 0 : copiedText.length,
            containsExpected: copiedText !== sentinel && copiedText.includes(request.expectedText),
          }
        } catch (error) {
          operationError = error
        }
        try {
          await window.desktopApi.clipboardWrite(previousClipboard)
          const clipboardRestored = (await window.desktopApi.clipboardRead()) === previousClipboard
          if (!clipboardRestored) throw new Error("Clipboard restoration verification failed")
          if (operationError || !copiedState) throw operationError ?? new Error("Copy failed")
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: { ...copiedState, clipboardRestored },
          })
        } catch (error) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Chat copy control failed",
          })
        }
        return
      }
      if (request.command === "agent-input.get") {
        const pending = [...appStore.get(pendingUserQuestionsAtom).values()].slice(0, 100)
        const countsByParentChatId: Record<string, number> = {}
        for (const request of pending) {
          countsByParentChatId[request.parentChatId] =
            (countsByParentChatId[request.parentChatId] ?? 0) + 1
        }
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            selectedChatId: appStore.get(selectedAgentChatIdAtom),
            activeSubChatId: useAgentSubChatStore.getState().activeSubChatId,
            desktopView: appStore.get(desktopViewAtom),
            pendingRequestIds: pending.map((item) => item.toolUseId),
            countsByParentChatId,
          },
        })
        return
      }
      if (request.command === "usage-ui.get" || request.command === "usage-ui.control") {
        if (request.command === "usage-ui.control") {
          let action: HTMLElement | null | undefined
          if (request.operation === "open") {
            appStore.set(desktopViewAtom, "usage")
            action = document.body
          } else if (request.operation === "open-monitoring") {
            const details = document.querySelector<HTMLDetailsElement>(
              '[data-dev-usage-control="monitoring"]',
            )
            if (details) details.open = true
            action = details
          } else if (request.operation === "scroll-to") {
            action = document.querySelector<HTMLElement>(
              `[data-dev-usage-section="${request.target}"]`,
            )
            action?.scrollIntoView({ block: "start" })
          } else if (request.operation === "show-all") {
            action = Array.from(
              document.querySelectorAll<HTMLElement>('[data-dev-usage-action="show-all"]'),
            ).find((element) => element.dataset.devUsagePaging === request.target)
            action?.click()
          } else {
            const control =
              request.operation === "select-provider"
                ? "provider"
                : request.operation === "set-scope"
                  ? "scope"
                  : request.operation === "set-history-mode"
                    ? "history-mode"
                    : "history-range"
            action = Array.from(
              document.querySelectorAll<HTMLElement>(`[data-dev-usage-control="${control}"]`),
            ).find((element) => element.dataset.value === request.value)
            if (action?.getAttribute("role") === "tab") {
              action.dispatchEvent(
                new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
              )
            } else {
              action?.click()
            }
          }
          if (!action) {
            window.desktopApi.respondDevRendererControl({
              requestId: request.requestId,
              ok: false,
              error: "Requested Usage UI action is not mounted",
            })
            return
          }
        }
        window.setTimeout(() => {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: readUsageUiState(document),
          })
        }, 100)
        return
      }
      if (request.command === "voice-ui.get" || request.command === "voice-ui.control") {
        if (request.command === "voice-ui.get") {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: readVoiceUiState(document, request.historyId),
          })
          return
        }
        const preservesClipboard = ["copy-history", "insert-history"].includes(request.operation)
        const previousClipboard = preservesClipboard
          ? await window.desktopApi.clipboardRead()
          : undefined
        const sentinel = `flapstack-dev-voice-${crypto.randomUUID()}`
        let fixtureClipboardMatch = false
        let operationError: unknown
        if (preservesClipboard) await window.desktopApi.clipboardWrite(sentinel)
        if (request.command === "voice-ui.control") {
          let action: HTMLElement | null | undefined
          try {
            if (request.operation === "open") {
              await trpcUtils.speech.searchHistory.invalidate()
              await trpcUtils.speech.getSettings.invalidate()
              appStore.set(desktopViewAtom, "settings")
              appStore.set(agentsSettingsDialogActiveTabAtom, "voice")
              appStore.set(agentsSettingsDialogOpenAtom, true)
              action = document.body
            } else if (["search", "set-stt", "set-tts", "set-rate"].includes(request.operation)) {
              const control =
                request.operation === "search"
                  ? "history-search"
                  : request.operation === "set-stt"
                    ? "stt-adapter"
                    : request.operation === "set-tts"
                      ? "tts-adapter"
                      : "rate"
              const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(
                `[data-dev-voice-control="${control}"]`,
              )
              if (input) {
                const setter = Object.getOwnPropertyDescriptor(
                  input instanceof HTMLSelectElement
                    ? HTMLSelectElement.prototype
                    : HTMLInputElement.prototype,
                  "value",
                )?.set
                setter?.call(input, request.value ?? "")
                input.dispatchEvent(new Event("change", { bubbles: true }))
              }
              action = input
            } else if (["preview", "stop"].includes(request.operation)) {
              action = document.querySelector<HTMLElement>(
                `[data-dev-voice-action="${request.operation}"]`,
              )
              action?.click()
            } else {
              const row = Array.from(
                document.querySelectorAll<HTMLElement>("[data-dev-voice-history-id]"),
              ).find((element) => element.dataset.devVoiceHistoryId === request.historyId)
              action = row?.querySelector<HTMLElement>(
                `[data-dev-voice-action="${request.operation}"]`,
              )
              if (request.operation === "delete-history") {
                const previousConfirm = window.confirm
                window.confirm = () => true
                try {
                  action?.click()
                } finally {
                  window.confirm = previousConfirm
                }
              } else {
                action?.click()
              }
            }
            if (!action) throw new Error("Requested Voice UI action is not mounted")
          } catch (error) {
            operationError = error
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200))
        let clipboardRestored: boolean | undefined
        if (preservesClipboard) {
          try {
            const clipboard = await window.desktopApi.clipboardRead()
            fixtureClipboardMatch = clipboard !== sentinel && clipboard.includes(DEV_VOICE_UI_TEXT)
            await window.desktopApi.clipboardWrite(previousClipboard ?? "")
            clipboardRestored =
              (await window.desktopApi.clipboardRead()) === (previousClipboard ?? "")
            if (!clipboardRestored) throw new Error("Clipboard restoration verification failed")
          } catch (error) {
            operationError ??= error
          }
        }
        if (operationError) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error:
              operationError instanceof Error ? operationError.message : "Voice UI control failed",
          })
          return
        }
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            ...readVoiceUiState(document, request.historyId),
            ...(preservesClipboard ? { fixtureClipboardMatch, clipboardRestored } : {}),
          },
        })
        return
      }
      if (request.command === "orchestration.get") {
        const subChatState = useAgentSubChatStore.getState()
        const selectedChatId = appStore.get(selectedAgentChatIdAtom)
        const detailsOpen = appStore.get(detailsSidebarOpenAtom)
        const detailsTab = appStore.get(detailsSidebarTabAtom)
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            selectedChatId,
            activeSubChatId: subChatState.activeSubChatId,
            selectedProjectId: appStore.get(selectedProjectAtom)?.id ?? null,
            detailsOpen,
            detailsTab,
            card:
              selectedChatId && detailsOpen && detailsTab === "details"
                ? readRendererOrchestrationCard(document, request.taskId, selectedChatId)
                : null,
          },
        })
        return
      }
      if (request.command === "mcp.get" || request.command === "mcp.control") {
        if (request.command === "mcp.control") {
          const open = request.operation === "open-audit"
          appStore.set(productMcpAuditOpenChatIdsAtom, (current: Set<string>) => {
            const next = new Set(current)
            if (open) next.add(request.chatId)
            else next.delete(request.chatId)
            return next
          })
          if (open) {
            appStore.set(unifiedSidebarEnabledAtom, true)
            appStore.set(detailsSidebarOpenAtom, true)
            appStore.set(detailsSidebarTabAtom, "details")
            const visibilityAtom = widgetVisibilityAtomFamily(request.chatId)
            const visible = appStore.get(visibilityAtom)
            if (!visible.includes("mcp")) appStore.set(visibilityAtom, [...visible, "mcp"])
          }
        }
        const visible = appStore.get(widgetVisibilityAtomFamily(request.chatId))
        const callerElements = (selector: string) =>
          Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
            (element) => element.dataset.mcpCallerChatId === request.chatId,
          )
        const exposureElement = Array.from(
          document.querySelectorAll<HTMLElement>("[data-product-mcp-exposure-chat-id]"),
        ).find((element) => element.dataset.productMcpExposureChatId === request.chatId)
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            chatId: request.chatId,
            selectedChatId: appStore.get(selectedAgentChatIdAtom),
            detailsOpen: appStore.get(detailsSidebarOpenAtom),
            detailsTab: appStore.get(detailsSidebarTabAtom),
            mcpVisible: visible.includes("mcp"),
            auditOpen: appStore.get(productMcpAuditOpenChatIdsAtom).has(request.chatId),
            auditRendered: Boolean(
              exposureElement?.querySelector('section[aria-label="MCP audit history"]'),
            ),
            exposureRendered: Boolean(exposureElement),
            exposureText: exposureElement?.textContent?.trim().slice(0, 1_000) ?? null,
            approvalDialogOpen: callerElements('[data-mcp-approval-dialog="active"]').length > 0,
            backgroundApprovalVisible:
              callerElements('[data-mcp-approval-notice="background"] [data-mcp-caller-chat-id]')
                .length > 0,
            reviewActionVisible: callerElements("button[data-mcp-caller-chat-id]").length > 0,
          },
        })
        return
      }
      if (
        request.command === "permissions.ui.get" ||
        request.command === "permissions.ui.control"
      ) {
        void invokePermissionUiTestControl(request)
          .then((state) =>
            window.desktopApi.respondDevRendererControl({
              requestId: request.requestId,
              ok: true,
              state,
            }),
          )
          .catch((error: unknown) =>
            window.desktopApi.respondDevRendererControl({
              requestId: request.requestId,
              ok: false,
              error: error instanceof Error ? error.message : "Permission UI control failed",
            }),
          )
        return
      }
      if (request.command === "carryover.get") {
        const selector = `[data-dev-carryover-surface="${request.surface}"]`
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
          (element) => !request.runId || element.dataset.runId === request.runId,
        )
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            surface: request.surface,
            mounted: elements.length > 0,
            selectedChatId: appStore.get(selectedAgentChatIdAtom),
            activeSubChatId: useAgentSubChatStore.getState().activeSubChatId,
            desktopView: appStore.get(desktopViewAtom),
            items: elements
              .slice(0, 100)
              .map((element) => boundedCarryoverDataset(element, request.surface)),
          },
        })
        return
      }
      if (request.command === "carryover.control") {
        const selector = `[data-dev-carryover-surface="${request.surface}"]`
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
          (element) => !request.runId || element.dataset.runId === request.runId,
        )
        const element = elements[request.index ?? 0]
        const action = element?.querySelector<HTMLElement>(
          `[data-dev-carryover-action="${request.operation}"]`,
        )
        if (!element || !action) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: "Requested carryover surface action is not mounted",
          })
          return
        }
        action.click()
        window.requestAnimationFrame(() => {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: true,
            state: {
              surface: request.surface,
              operation: request.operation,
              item: boundedCarryoverDataset(element, request.surface),
            },
          })
        })
        return
      }
      const platform = request.platform ?? undefined
      const customHotkeysConfig = appStore.get(customHotkeysAtom)
      if (request.command === "shortcuts.get") {
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: buildShortcutState(customHotkeysConfig, platform),
        })
        return
      }
      if (request.command !== "shortcuts.mutate") return
      const mutation = mutateShortcutConfig(
        customHotkeysConfig,
        {
          operation: request.operation,
          actionId: request.actionId,
          hotkey: request.hotkey,
        },
        platform,
      )
      window.desktopApi.respondDevRendererControl({
        requestId: request.requestId,
        ok: mutation.ok,
        ...(mutation.ok ? {} : { error: mutation.error }),
        state: buildShortcutState(mutation.config, platform),
      })
      if (mutation.ok) appStore.set(customHotkeysAtom, mutation.config)
    })
  }, [trpcUtils])

  return null
}
