import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  devToolsUnlockedAtom,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
} from "../../lib/atoms"
import { desktopViewAtom } from "../agents/atoms"
import { AgentsAppearanceTab } from "../../components/dialogs/settings-tabs/agents-appearance-tab"
import { AgentsDebugTab } from "../../components/dialogs/settings-tabs/agents-debug-tab"
import { AgentsMcpTab } from "../../components/dialogs/settings-tabs/agents-mcp-tab"
import { AgentsModelsTab } from "../../components/dialogs/settings-tabs/agents-models-tab"
import { AgentsLocalModelsTab } from "../../components/dialogs/settings-tabs/agents-local-models-tab"
import { AgentsPreferencesTab } from "../../components/dialogs/settings-tabs/agents-preferences-tab"
import { AgentsPermissionsTab } from "../../components/dialogs/settings-tabs/agents-permissions-tab"
import { AgentsProjectsTab } from "../../components/dialogs/settings-tabs/agents-project-worktree-tab"
import { AgentsProviderExtensionsTab } from "../../components/dialogs/settings-tabs/agents-provider-extensions-tab"
import { AgentsApiProvidersTab } from "../../components/dialogs/settings-tabs/agents-api-providers-tab"
import { AgentsUsageTab } from "../../components/dialogs/settings-tabs/agents-usage-tab"
import { AgentsVoiceTab } from "../../components/dialogs/settings-tabs/agents-voice-tab"
import { AgentsKeyboardTab } from "../../components/dialogs/settings-tabs/agents-keyboard-tab"
import { AgentsPortabilityTab } from "../../components/dialogs/settings-tabs/agents-portability-tab"
import { normalizeVisibleSettingsTab } from "./settings-visibility"
import { revealSettingsTarget } from "./settings-target"

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV

export function SettingsContent() {
  const storedActiveTab = useAtomValue(agentsSettingsDialogActiveTabAtom)
  const setActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [searchQuery, setSearchQuery] = useAtom(settingsSearchQueryAtom)
  const [searchTarget, setSearchTarget] = useAtom(settingsSearchTargetAtom)
  const devToolsUnlocked = useAtomValue(devToolsUnlockedAtom)
  const showDebugTab = isDevelopment || devToolsUnlocked
  const activeTab = normalizeVisibleSettingsTab(storedActiveTab, {
    showDevelopment: showDebugTab,
  })
  const setDesktopView = useSetAtom(desktopViewAtom)

  useEffect(() => {
    if (activeTab !== storedActiveTab) setActiveTab(activeTab)
  }, [activeTab, setActiveTab, storedActiveTab])

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        if (searchQuery) {
          setSearchQuery("")
          return
        }
        setDesktopView(null)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [searchQuery, setDesktopView, setSearchQuery])

  useEffect(() => {
    if (!searchTarget) return

    const frame = requestAnimationFrame(() => {
      revealSettingsTarget(searchTarget)
      setSearchTarget(null)
    })

    return () => cancelAnimationFrame(frame)
  }, [activeTab, searchTarget, setSearchTarget])

  const renderTabContent = () => {
    switch (activeTab) {
      case "appearance":
        return <AgentsAppearanceTab />
      case "preferences":
        return <AgentsPreferencesTab />
      case "permissions":
        return <AgentsPermissionsTab />
      case "models":
        return <AgentsModelsTab />
      case "local-models":
        return <AgentsLocalModelsTab />
      case "api-providers":
        return <AgentsApiProvidersTab />
      case "voice":
        return <AgentsVoiceTab />
      case "keyboard":
        return <AgentsKeyboardTab />
      case "skills":
        return <AgentsProviderExtensionsTab initialKind="skill" />
      case "agents":
        return <AgentsProviderExtensionsTab initialKind="custom-agent" />
      case "mcp":
        return <AgentsMcpTab />
      case "plugins":
        return <AgentsProviderExtensionsTab initialKind="plugin" />
      case "projects":
        return <AgentsProjectsTab />
      case "usage":
        return <AgentsUsageTab />
      case "portability":
        return <AgentsPortabilityTab />
      case "debug":
        return showDebugTab ? <AgentsDebugTab /> : null
      default:
        return null
    }
  }

  // Two-panel tabs need full width and height, no scroll wrapper
  const isTwoPanelTab =
    activeTab === "mcp" ||
    activeTab === "skills" ||
    activeTab === "agents" ||
    activeTab === "projects" ||
    activeTab === "plugins"

  if (isTwoPanelTab) {
    return (
      <div
        className="h-full overflow-hidden outline-none"
        data-settings-id={`settings-tab-${activeTab}`}
        tabIndex={-1}
      >
        {renderTabContent()}
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto outline-none"
      data-settings-id={`settings-tab-${activeTab}`}
      tabIndex={-1}
    >
      <div className={activeTab === "usage" ? "mx-auto w-full max-w-7xl" : "mx-auto max-w-2xl"}>
        {renderTabContent()}
      </div>
    </div>
  )
}
