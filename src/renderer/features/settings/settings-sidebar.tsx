import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronLeft, Keyboard, Mic, Search, ShieldCheck, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EyeOpenFilledIcon, SlidersFilledIcon } from "../../icons"
import {
  agentsSettingsDialogActiveTabAtom,
  devToolsUnlockedAtom,
  isDesktopAtom,
  settingsSearchQueryAtom,
  settingsSearchTargetAtom,
  type SettingsTab,
} from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import {
  BrainFilledIcon,
  BugFilledIcon,
  CustomAgentIconFilled,
  FolderFilledIcon,
  OriginalMCPIcon,
  PluginFilledIcon,
  SkillIconFilled,
} from "../../components/ui/icons"
import { desktopViewAtom } from "../agents/atoms"
import { searchSettings, type SettingsSearchEntry } from "./settings-search"
import { getVisibleSettingsTabs, type SettingsProviderScope } from "./settings-visibility"

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV

const SETTINGS_TAB_ICONS: Partial<
  Record<SettingsTab, React.ComponentType<{ className?: string }>>
> = {
  preferences: SlidersFilledIcon,
  permissions: ShieldCheck,
  appearance: EyeOpenFilledIcon,
  projects: FolderFilledIcon,
  models: BrainFilledIcon,
  "api-providers": BrainFilledIcon,
  voice: Mic,
  keyboard: Keyboard,
  skills: SkillIconFilled,
  agents: CustomAgentIconFilled,
  mcp: OriginalMCPIcon,
  plugins: PluginFilledIcon,
  usage: SlidersFilledIcon,
  debug: BugFilledIcon,
}

interface TabButtonProps {
  tab: {
    id: SettingsTab
    label: string
    icon: React.ComponentType<{ className?: string }> | any
  }
  isActive: boolean
  onClick: () => void
}

function TabButton({ tab, isActive, onClick }: TabButtonProps) {
  const Icon = tab.icon
  const isProjectTab = "projectId" in tab

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap transition-colors duration-75 cursor-pointer w-full justify-start gap-2 text-left px-3 py-1.5 text-sm h-7 rounded-md",
        "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
        isActive
          ? "bg-foreground/5 text-foreground font-medium"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground font-medium",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          isProjectTab ? "opacity-100" : isActive ? "opacity-100" : "opacity-50",
        )}
      />
      <span className="flex-1 truncate">{tab.label}</span>
    </button>
  )
}

export function SettingsSidebar() {
  const [activeTab, setActiveTab] = useAtom(agentsSettingsDialogActiveTabAtom)
  const [searchQuery, setSearchQuery] = useAtom(settingsSearchQueryAtom)
  const setSearchTarget = useSetAtom(settingsSearchTargetAtom)
  const devToolsUnlocked = useAtomValue(devToolsUnlockedAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const isDesktop = useAtomValue(isDesktopAtom)
  const { data: apiProviders = [] } = trpc.opencode.listProviders.useQuery()

  // Settings has its own full-width drag bar, so keep the native macOS window
  // controls available for minimize, fullscreen, and window management.
  useEffect(() => {
    if (!isDesktop) return
    if (typeof window === "undefined" || !window.desktopApi?.setTrafficLightVisibility) return
    window.desktopApi.setTrafficLightVisibility(true)
  }, [isDesktop])

  const searchInputRef = useRef<HTMLInputElement>(null)
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0)

  // Show debug tab if in development OR if devtools are unlocked
  const showDebugTab = isDevelopment || devToolsUnlocked

  const mainTabs = useMemo(
    () =>
      getVisibleSettingsTabs("main", { showDevelopment: showDebugTab }).map((tab) => ({
        ...tab,
        icon: SETTINGS_TAB_ICONS[tab.id] ?? SlidersFilledIcon,
      })),
    [showDebugTab],
  )
  const advancedTabs = useMemo(
    () =>
      getVisibleSettingsTabs("advanced", { showDevelopment: showDebugTab }).map((tab) => ({
        ...tab,
        icon: SETTINGS_TAB_ICONS[tab.id] ?? SlidersFilledIcon,
      })),
    [showDebugTab],
  )

  const availableApiProviders = useMemo(
    () =>
      apiProviders
        .map((provider) => provider.id)
        .filter(
          (provider): provider is Extract<SettingsProviderScope, "openrouter" | "nanogpt"> =>
            provider === "openrouter" || provider === "nanogpt",
        ),
    [apiProviders],
  )

  const searchResults = useMemo(
    () =>
      searchSettings(searchQuery, {
        showDevelopment: showDebugTab,
        availableProviders: availableApiProviders,
      }),
    [availableApiProviders, searchQuery, showDebugTab],
  )

  useEffect(() => {
    setSelectedSearchIndex(0)
  }, [searchQuery])

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    document.addEventListener("keydown", handleFind)
    return () => document.removeEventListener("keydown", handleFind)
  }, [])

  const handleTabClick = (tabId: SettingsTab) => {
    setActiveTab(tabId)
  }

  const handleBack = useCallback(() => {
    setSearchQuery("")
    setDesktopView(null)
  }, [setDesktopView, setSearchQuery])

  const selectSearchResult = useCallback(
    (result: SettingsSearchEntry) => {
      setActiveTab(result.tab)
      setSearchTarget(result.targetId)
      setSearchQuery("")
    },
    [setActiveTab, setSearchQuery, setSearchTarget],
  )

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && searchResults.length > 0) {
        event.preventDefault()
        setSelectedSearchIndex((index) => (index + 1) % searchResults.length)
      } else if (event.key === "ArrowUp" && searchResults.length > 0) {
        event.preventDefault()
        setSelectedSearchIndex((index) => (index - 1 + searchResults.length) % searchResults.length)
      } else if (event.key === "Enter") {
        const result = searchResults[selectedSearchIndex]
        if (result) {
          event.preventDefault()
          selectSearchResult(result)
        }
      }
    },
    [searchResults, selectSearchResult, selectedSearchIndex],
  )

  return (
    <div className="flex flex-col h-full bg-tl-background" data-sidebar-content>
      {/* Back button */}
      <div className="px-2 pt-3 pb-2">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm h-7 rounded-md text-muted-foreground hover:text-foreground font-medium transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search settings"
            aria-label="Search settings"
            aria-activedescendant={
              searchQuery && searchResults[selectedSearchIndex]
                ? `settings-search-result-${searchResults[selectedSearchIndex].id}`
                : undefined
            }
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("")
                searchInputRef.current?.focus()
              }}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              aria-label="Clear Settings search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent px-2 pb-4 space-y-4">
        {searchQuery ? (
          <div className="space-y-1" role="listbox" aria-label="Settings search results">
            {searchResults.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">No matching settings.</div>
            ) : (
              searchResults.map((result, index) => (
                <button
                  key={result.id}
                  id={`settings-search-result-${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={selectedSearchIndex === index}
                  onMouseEnter={() => setSelectedSearchIndex(index)}
                  onClick={() => selectSearchResult(result)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left outline-none transition-colors",
                    selectedSearchIndex === index
                      ? "bg-foreground/5 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
                  )}
                >
                  <span className="block truncate text-xs font-medium">{result.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {result.tab === "api-providers"
                      ? "API Providers"
                      : result.tab.charAt(0).toUpperCase() + result.tab.slice(1)}
                    {result.description ? ` · ${result.description}` : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {/* Main Tabs */}
            <div className="space-y-1">
              {mainTabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  tab={tab}
                  isActive={activeTab === tab.id}
                  onClick={() => handleTabClick(tab.id)}
                />
              ))}
            </div>

            {/* Separator */}
            <div className="border-t border-border/50 mx-2" />

            {/* Advanced Tabs */}
            <div className="space-y-1">
              {advancedTabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  tab={tab}
                  isActive={activeTab === tab.id}
                  onClick={() => handleTabClick(tab.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
