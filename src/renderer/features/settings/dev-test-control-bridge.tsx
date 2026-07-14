import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  ctrlTabTargetAtom,
  customHotkeysAtom,
  getReleasedCtrlTabTarget,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
} from "../../lib/atoms"
import { buildShortcutState, mutateShortcutConfig } from "../../lib/hotkeys"
import { appStore } from "../../lib/jotai-store"
import { trpc } from "../../lib/trpc"
import {
  desktopViewAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedProjectAtom,
} from "../agents/atoms"
import { readRendererOrchestrationCard } from "../agents/lib/orchestration-test-state"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { invokePermissionUiTestControl } from "../agents/lib/permission-ui-test-control"
import {
  detailsSidebarOpenAtom,
  detailsSidebarTabAtom,
  productMcpAuditOpenChatIdsAtom,
  unifiedSidebarEnabledAtom,
  widgetVisibilityAtomFamily,
} from "../details-sidebar/atoms"
import { SETTINGS_TAB_REGISTRY, normalizeVisibleSettingsTab } from "./settings-visibility"
import { chatBelongsToProject, refreshDevSelectionSnapshot } from "./dev-test-selection-refresh"

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
        const projectActive = snapshot.projects.some((project) => project.id === request.project.id)
        if (!projectActive || snapshot.targetChat?.projectId !== request.project.id) {
          window.desktopApi.respondDevRendererControl({
            requestId: request.requestId,
            ok: false,
            error: "Test chat project state is stale",
          })
          return
        }
        const store = useAgentSubChatStore.getState()
        store.setChatId(null)
        store.queueNavigation(request.chatId, request.subChatId)
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
        store.setChatId(request.chatId)
        const selectedSubChatId = useAgentSubChatStore.getState().activeSubChatId
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
