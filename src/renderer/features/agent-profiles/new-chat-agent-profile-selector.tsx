import { Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { trpc } from "../../lib/trpc"
import { handleListboxKeyDown } from "../../lib/listbox-keyboard"
import type { AgentRuntimePreference } from "../../../shared/agent-runtime"
import { AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES } from "../../../shared/agent-profiles"

export type NewChatAgentProfileSelection = {
  profile: { profileId: string; version: number }
  digest: string
  harness: string
  model: string | null
  runtimePreference: AgentRuntimePreference
  permissionMode: string
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null
  speedPreference: "standard" | "fast" | null
}
export type NewChatAgentProfileSelectionState =
  NewChatAgentProfileSelection | { invalid: true } | null

export function NewChatAgentProfileSelector({
  scope,
  projectId,
  taskId,
  permissionMode,
  runtimePreference,
  onSelectionChange,
}: {
  scope: "global" | "project" | "task"
  projectId?: string
  taskId?: string
  permissionMode: string
  runtimePreference: AgentRuntimePreference
  onSelectionChange: (selection: NewChatAgentProfileSelectionState) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<{ profileId: string; version: number } | null>(null)
  const list = trpc.agentProfiles.searchForNewChat.useQuery({
    scope,
    projectId,
    taskId,
    query,
  })
  const preview = trpc.agentProfiles.previewNewChatBinding.useQuery(
    {
      scope,
      projectId,
      taskId,
      permissionMode,
      runtimePreference,
      profile: selected ?? { profileId: "none", version: 1 },
    },
    { enabled: selected !== null },
  )
  const selectedChoice = useMemo(
    () =>
      list.data?.find(
        (choice) =>
          choice.profile.profileId === selected?.profileId &&
          choice.profile.version === selected.version,
      ) ?? null,
    [list.data, selected],
  )
  const blockingMessage =
    preview.error?.message ??
    preview.data?.conflicts.find((conflict) =>
      (AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES as readonly string[]).includes(conflict.code),
    )?.message ??
    preview.data?.unresolvedRequirements[0]?.reason ??
    null

  useEffect(() => {
    const value = preview.data
    if (!selected) {
      onSelectionChange(null)
      return
    }
    if (!value || blockingMessage) {
      onSelectionChange({ invalid: true })
      return
    }
    onSelectionChange({
      profile: selected,
      digest: value.digest,
      harness: value.capability.harness,
      model: value.capability.modelPreference,
      runtimePreference: value.runtimeResolution.preference,
      permissionMode: value.capability.permissionMode,
      reasoningEffort: value.capability.reasoningEffort,
      speedPreference: value.capability.speedPreference,
    })
  }, [blockingMessage, onSelectionChange, preview.data, selected])

  useEffect(() => {
    setSelected(null)
  }, [projectId, scope, taskId])

  return (
    <section
      aria-labelledby="new-chat-agent-profile-heading"
      className="mb-2 rounded-lg border border-border/70 bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="new-chat-agent-profile-heading" className="text-sm font-medium">
            Agent Profile
          </h2>
          <p className="text-xs text-muted-foreground">
            Optional. One exact version is frozen when the first run starts.
          </p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-label="Choose Agent Profile">
              {selectedChoice
                ? `${selectedChoice.name} v${selectedChoice.profile.version}`
                : "Choose profile"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-2">
            <label className="relative block">
              <span className="sr-only">Search Agent Profiles</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search profiles"
                className="pl-8"
                autoFocus
              />
            </label>
            <div
              role="listbox"
              aria-label="Compatible Agent Profiles"
              aria-orientation="vertical"
              className="mt-2 max-h-64 overflow-y-auto"
              onKeyDown={handleListboxKeyDown}
            >
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start px-2 py-2 text-left"
                role="option"
                aria-selected={selected === null}
                tabIndex={selected === null ? 0 : -1}
                onClick={() => {
                  setSelected(null)
                  setOpen(false)
                }}
              >
                No Agent Profile
              </Button>
              {list.data?.map((choice) => (
                <Button
                  key={`${choice.profile.profileId}@${choice.profile.version}`}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  role="option"
                  aria-selected={
                    selected?.profileId === choice.profile.profileId &&
                    selected.version === choice.profile.version
                  }
                  tabIndex={
                    selected?.profileId === choice.profile.profileId &&
                    selected.version === choice.profile.version
                      ? 0
                      : -1
                  }
                  onClick={() => {
                    setSelected(choice.profile)
                    setOpen(false)
                  }}
                >
                  <span>
                    <span className="block text-sm font-medium">
                      {choice.name} v{choice.profile.version}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {choice.category} · {choice.description}
                    </span>
                  </span>
                </Button>
              ))}
              {!list.isLoading && list.data?.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No compatible Agent Profiles match this Chat scope.
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {selected ? (
        <div className="mt-3" aria-live="polite">
          {preview.isLoading ? (
            <p className="text-xs text-muted-foreground">Resolving exact profile preview…</p>
          ) : blockingMessage ? (
            <p role="alert" className="text-xs text-destructive">
              Profile unavailable: {blockingMessage}
            </p>
          ) : preview.data ? (
            <>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
                <PreviewRow label="Provider" value={preview.data.capability.harness} />
                <PreviewRow
                  label="Model"
                  value={preview.data.capability.modelPreference ?? "Provider default"}
                />
                <PreviewRow label="Runtime" value={preview.data.runtimeResolution.preference} />
                <PreviewRow label="Permissions" value={preview.data.capability.permissionMode} />
                <PreviewRow
                  label="Effort"
                  value={preview.data.capability.reasoningEffort ?? "Provider default"}
                />
                <PreviewRow
                  label="Speed"
                  value={preview.data.capability.speedPreference ?? "Standard"}
                />
                <PreviewRow label="Worktree" value={preview.data.capability.worktreeStrategy} />
                <PreviewRow
                  label="Skills"
                  value={preview.data.capability.skills.join(", ") || "None"}
                />
              </dl>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {preview.data.profile.profileId}@{preview.data.profile.version} ·{" "}
                {preview.data.personality
                  ? `${preview.data.personality.ref.personalityId}@${preview.data.personality.ref.version}`
                  : "no personality"}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-2 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  )
}
