import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  customHotkeysAtom,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
} from "../../lib/atoms"
import { buildShortcutState, mutateShortcutConfig } from "../../lib/hotkeys"
import { appStore } from "../../lib/jotai-store"
import { desktopViewAtom, selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import {
  detailsSidebarOpenAtom,
  detailsSidebarTabAtom,
  productMcpAuditOpenChatIdsAtom,
  widgetVisibilityAtomFamily,
} from "../details-sidebar/atoms"
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
      if (request.command === "settings.get") {
        window.desktopApi.respondDevRendererControl({
          requestId: request.requestId,
          ok: true,
          state: settingsState,
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
