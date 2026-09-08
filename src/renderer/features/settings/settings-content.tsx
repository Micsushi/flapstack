import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  devToolsUnlockedAtom,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
  type SettingsTab,
} from "../../lib/atoms"
import { desktopViewAtom } from "../agents/atoms"
import { AgentsAppearanceTab } from "../../components/dialogs/settings-tabs/agents-appearance-tab"
import { AgentsDebugTab } from "../../components/dialogs/settings-tabs/agents-debug-tab"
import { AgentsPluginsHubTab } from "../../components/dialogs/settings-tabs/agents-plugins-hub-tab"
import { AgentsModelsTab } from "../../components/dialogs/settings-tabs/agents-models-tab"
import { AgentsRuntimesTab } from "../../components/dialogs/settings-tabs/agents-runtimes-tab"
import { AgentsLocalModelsTab } from "../../components/dialogs/settings-tabs/agents-local-models-tab"
import { AgentsMobileCompanionTab } from "../../components/dialogs/settings-tabs/agents-mobile-companion-tab"
import { AgentsCoordinationEnginesTab } from "../../components/dialogs/settings-tabs/agents-coordination-engines-tab"
import { AgentsProfilesStudioTab } from "../../components/dialogs/settings-tabs/agents-profiles-studio-tab"
import { AgentsPreferencesTab } from "../../components/dialogs/settings-tabs/agents-preferences-tab"
import { AgentsPermissionsTab } from "../../components/dialogs/settings-tabs/agents-permissions-tab"
import { AgentsProjectsTab } from "../../components/dialogs/settings-tabs/agents-project-worktree-tab"
import { AgentsProviderExtensionsTab } from "../../components/dialogs/settings-tabs/agents-provider-extensions-tab"
import { AgentsApiProvidersTab } from "../../components/dialogs/settings-tabs/agents-api-providers-tab"
import { AgentsUsageTab } from "../../components/dialogs/settings-tabs/agents-usage-tab"
import { AgentsVoiceTab } from "../../components/dialogs/settings-tabs/agents-voice-tab"
import { AgentsKeyboardTab } from "../../components/dialogs/settings-tabs/agents-keyboard-tab"
import { AgentsPortabilityTab } from "../../components/dialogs/settings-tabs/agents-portability-tab"
import { AgentsBetaTab } from "../../components/dialogs/settings-tabs/agents-beta-tab"
import { AgentsFeatureVisibilityTab } from "../../components/dialogs/settings-tabs/agents-feature-visibility-tab"
import { Button } from "../../components/ui/button"
import { getVisibleSettingsTabs, normalizeVisibleSettingsTab } from "./settings-visibility"
import { useBetaFeatures } from "./use-beta-features"
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
  const betaFeatures = useBetaFeatures()
  const activeTab = normalizeVisibleSettingsTab(storedActiveTab, {
    showDevelopment: showDebugTab,
    betaFeatures,
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
      case "feature-visibility":
        return <AgentsFeatureVisibilityTab />
      case "models":
        return <AgentsModelsTab />
      case "runtimes":
        return <AgentsRuntimesTab />
      case "local-models":
        return <AgentsLocalModelsTab />
      case "mobile-companion":
        return <AgentsMobileCompanionTab />
      case "coordination":
        return <AgentsCoordinationEnginesTab />
      case "agent-profiles":
        return <AgentsProfilesStudioTab />
      case "api-providers":
        return <AgentsApiProvidersTab />
      case "voice":
        return <AgentsVoiceTab />
      case "keyboard":
        return <AgentsKeyboardTab />
      case "skills":
        return <AgentsPluginsHubTab initialView="skills" />
      case "agents":
        return <AgentsProviderExtensionsTab initialKind="custom-agent" />
      case "mcp":
        return <AgentsPluginsHubTab initialView="mcp" />
      case "plugins":
        return <AgentsPluginsHubTab initialView="plugins" />
      case "projects":
        return <AgentsProjectsTab />
      case "usage":
        return <AgentsUsageTab />
      case "portability":
        return <AgentsPortabilityTab />
      case "beta":
        return <AgentsBetaTab />
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
    activeTab === "agent-profiles" ||
    activeTab === "projects" ||
    activeTab === "plugins"

  const visibleTabs = [
    ...getVisibleSettingsTabs("main", { showDevelopment: showDebugTab, betaFeatures }),
    ...getVisibleSettingsTabs("advanced", { showDevelopment: showDebugTab, betaFeatures }),
  ]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label="Settings navigation"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3 min-[600px]:hidden"
      >
        <Button variant="outline" onClick={() => setDesktopView(null)}>
          Back to chat
        </Button>
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">Settings section</span>
          <select
            aria-label="Settings section"
            value={activeTab}
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2"
            onChange={(event) => {
              setSearchQuery("")
              setSearchTarget(null)
              setActiveTab(event.target.value as SettingsTab)
            }}
          >
            {visibleTabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>
      </nav>
      <div
        className={
          isTwoPanelTab
            ? "min-h-0 flex-1 overflow-hidden outline-none"
            : "min-h-0 flex-1 overflow-y-auto outline-none"
        }
        data-settings-id={`settings-tab-${activeTab}`}
        tabIndex={-1}
      >
        {isTwoPanelTab ? (
          renderTabContent()
        ) : (
          <div className={activeTab === "usage" ? "mx-auto w-full max-w-7xl" : "mx-auto max-w-2xl"}>
            {renderTabContent()}
          </div>
        )}
      </div>
    </div>
  )
}
