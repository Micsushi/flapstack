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
import { desktopViewAtom, selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { invokePermissionUiTestControl } from "../agents/lib/permission-ui-test-control"
import { SETTINGS_TAB_REGISTRY, normalizeVisibleSettingsTab } from "./settings-visibility"

/** Always-mounted renderer half of the authenticated development test-control bridge. */
export function DevTestControlBridge() {
  useEffect(() => {
    if (!window.desktopApi?.onDevRendererControlRequest) return
    return window.desktopApi.onDevRendererControlRequest((request) => {
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
          appStore.set(selectedProjectAtom, request.project ?? null)
          nextState = { ...nextState, selectedProject: request.project ?? null }
        }
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: nextState,
        })
        return
      }
      if (request.command === "chat.select") {
        const store = useAgentSubChatStore.getState()
        store.queueNavigation(request.chatId, request.subChatId)
        appStore.set(selectedProjectAtom, request.project)
        appStore.set(selectedAgentChatIdAtom, request.chatId)
        appStore.set(agentsSettingsDialogOpenAtom, false)
        store.setChatId(request.chatId)
        const selectedSubChatId = useAgentSubChatStore.getState().activeSubChatId
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: {
            chatId: request.chatId,
            subChatId: selectedSubChatId,
            selectedProject: request.project,
            settingsOpen: false,
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
  }, [])

  return null
}
