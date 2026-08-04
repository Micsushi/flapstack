import { useSetAtom } from "jotai"
import { AppWindow, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import { agentsSettingsDialogActiveTabAtom, type SettingsTab } from "../../../lib/atoms"
import { cn } from "../../../lib/utils"
import { Button } from "../../ui/button"
import { OriginalMCPIcon, PluginFilledIcon, SkillIconFilled } from "../../ui/icons"
import { AgentsMcpTab } from "./agents-mcp-tab"
import { AgentsProviderExtensionsTab } from "./agents-provider-extensions-tab"

export type PluginsHubView = "plugins" | "apps" | "mcp" | "skills"

const hubTabs: Array<{
  id: PluginsHubView
  label: string
  icon: React.ComponentType<{ className?: string }>
  settingsTab?: SettingsTab
}> = [
  { id: "plugins", label: "Plugins", icon: PluginFilledIcon, settingsTab: "plugins" },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "mcp", label: "MCP servers", icon: OriginalMCPIcon, settingsTab: "mcp" },
  { id: "skills", label: "Skills", icon: SkillIconFilled, settingsTab: "skills" },
]

export function AgentsPluginsHubTab({ initialView }: { initialView: PluginsHubView }) {
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [activeView, setActiveView] = useState(initialView)

  useEffect(() => setActiveView(initialView), [initialView])

  const selectView = (view: PluginsHubView) => {
    setActiveView(view)
    const settingsTab = hubTabs.find((tab) => tab.id === view)?.settingsTab
    if (settingsTab) setSettingsTab(settingsTab)
  }

  const moveTabFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? hubTabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + hubTabs.length) % hubTabs.length
    const nextView = hubTabs[nextIndex].id
    selectView(nextView)
    requestAnimationFrame(() => document.getElementById(`plugins-hub-tab-${nextView}`)?.focus())
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-settings-id="plugins-hub">
      <header className="shrink-0 border-b border-border/70 px-6 pt-5">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Plugins</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage installed plugins, apps, MCP servers, and skills from one place.
          </p>
        </div>

        <div
          className="mt-5 flex min-w-0 gap-1 overflow-x-auto pb-3"
          role="tablist"
          aria-label="Plugin capability type"
        >
          {hubTabs.map((tab, index) => {
            const Icon = tab.icon
            const selected = activeView === tab.id
            return (
              <button
                key={tab.id}
                id={`plugins-hub-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="plugins-hub-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => selectView(tab.id)}
                onKeyDown={(event) => moveTabFocus(event, index)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-75",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "bg-foreground/[0.07] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4", !selected && "opacity-60")} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </header>

      <section
        id="plugins-hub-panel"
        role="tabpanel"
        aria-labelledby={`plugins-hub-tab-${activeView}`}
        className="min-h-0 flex-1 overflow-hidden"
      >
        {activeView === "plugins" ? (
          <AgentsProviderExtensionsTab initialKind="plugin" embedded />
        ) : activeView === "apps" ? (
          <AppsCompatibilityPanel onOpenMcp={() => selectView("mcp")} />
        ) : activeView === "mcp" ? (
          <AgentsMcpTab />
        ) : (
          <AgentsProviderExtensionsTab initialKind="skill" embedded />
        )}
      </section>
    </div>
  )
}

function AppsCompatibilityPanel({ onOpenMcp }: { onOpenMcp: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h2 className="text-[15px] font-semibold text-foreground">Apps in Flapstack</h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          ChatGPT-style apps are powered by MCP servers. Flapstack can use compatible app tools
          today; interactive app panels need an MCP Apps host bridge before they can render inside a
          chat.
        </p>

        <dl className="mt-6 divide-y divide-border/70 border-y border-border/70">
          <CompatibilityRow
            term="Tool access"
            status="Available through MCP"
            description="Connect the app's MCP endpoint and its tools become available to supported runtimes."
            tone="positive"
          />
          <CompatibilityRow
            term="Interactive UI"
            status="Host support needed"
            description="Flapstack does not yet host MCP Apps UI resources or their sandboxed message bridge."
            tone="attention"
          />
          <CompatibilityRow
            term="Account connection"
            status="Connect separately"
            description="ChatGPT installs and Flapstack connections are separate. Complete the server's OAuth flow in Flapstack."
          />
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onOpenMcp}>
            Manage MCP servers
          </Button>
          <a
            href="https://developers.openai.com/plugins/build/chatgpt-ui#start-with-mcp-apps"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            MCP Apps documentation
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

function CompatibilityRow({
  term,
  status,
  description,
  tone = "neutral",
}: {
  term: string
  status: string
  description: string
  tone?: "positive" | "attention" | "neutral"
}) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm font-medium text-foreground">{term}</dt>
      <dd>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 rounded-full",
              tone === "positive"
                ? "bg-emerald-500"
                : tone === "attention"
                  ? "bg-amber-500"
                  : "bg-muted-foreground/50",
            )}
          />
          {status}
        </div>
        <p className="mt-1 max-w-[65ch] text-xs leading-5 text-muted-foreground">{description}</p>
      </dd>
    </div>
  )
}
