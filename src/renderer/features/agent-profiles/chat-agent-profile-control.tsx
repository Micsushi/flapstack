import { LockKeyhole, Search } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { trpc } from "../../lib/trpc"
import { handleListboxKeyDown } from "../../lib/listbox-keyboard"
import { AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES } from "../../../shared/agent-profiles"

export function ChatAgentProfileControl({
  chatId,
  locked = false,
}: {
  chatId: string
  locked?: boolean
}) {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const binding = trpc.agentProfiles.getChatBinding.useQuery(
    { chatId },
    {
      refetchInterval: (result) =>
        !locked && result.state.data && !result.state.data.frozen ? 2_000 : false,
    },
  )
  const isLocked = locked || binding.data?.frozen === true
  const choices = trpc.agentProfiles.searchForChat.useQuery(
    { chatId, query },
    { enabled: !isLocked },
  )
  const bind = trpc.agentProfiles.bindChat.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.agentProfiles.getChatBinding.invalidate({ chatId }),
        utils.chats.get.invalidate({ id: chatId }),
        utils.chats.list.invalidate(),
      ])
      toast.success("Exact Agent Profile version selected for this Chat.")
    },
    onError: (error) => toast.error(error.message),
  })
  const selected = binding.data?.snapshot

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 max-w-64 gap-1.5 px-2"
            title={isLocked ? "Agent Profile locked after the first message" : undefined}
            aria-label={
              selected
                ? `${isLocked ? "Locked " : ""}Agent Profile ${selected.displayName} version ${selected.profile.version}`
                : "Choose Agent Profile"
            }
          >
            <span className="truncate">
              {selected ? `${selected.displayName} v${selected.profile.version}` : "Agent Profile"}
            </span>
            {isLocked ? (
              <LockKeyhole className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-2">
          <label className="relative block">
            <span className="sr-only">Search compatible Agent Profiles</span>
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
          {isLocked ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This Chat has started. Its exact profile snapshot cannot change.
            </p>
          ) : null}
          {!isLocked && binding.data?.invalidReason ? (
            <div
              role="alert"
              className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              <span className="font-medium">Selected profile unavailable.</span>{" "}
              {binding.data.invalidReason}
            </div>
          ) : null}
          {!isLocked ? (
            <div
              role="listbox"
              aria-label="Compatible Agent Profiles"
              aria-orientation="vertical"
              className="mt-2 max-h-64 overflow-y-auto"
              onKeyDown={handleListboxKeyDown}
            >
              {choices.data?.map((choice, index) => (
                <Button
                  key={`${choice.profile.profileId}@${choice.profile.version}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={
                    selected?.profile.profileId === choice.profile.profileId &&
                    selected.profile.version === choice.profile.version
                  }
                  tabIndex={
                    (selected?.profile.profileId === choice.profile.profileId &&
                      selected.profile.version === choice.profile.version) ||
                    (!selected && index === 0)
                      ? 0
                      : -1
                  }
                  disabled={bind.isPending}
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  onClick={async () => {
                    try {
                      const preview = await utils.agentProfiles.previewChatBinding.fetch({
                        chatId,
                        profile: choice.profile,
                      })
                      const blocker =
                        preview.conflicts.find((conflict) =>
                          (
                            AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES as readonly string[]
                          ).includes(conflict.code),
                        )?.message ?? preview.unresolvedRequirements[0]?.reason
                      if (blocker) {
                        toast.error(blocker)
                        return
                      }
                      await bind.mutateAsync({
                        chatId,
                        profile: choice.profile,
                        confirmedDigest: preview.digest,
                      })
                      setOpen(false)
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : String(error))
                    }
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
            </div>
          ) : null}
          {selected ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
              <Row label="Provider" value={selected.capability.harness} />
              <Row label="Runtime" value={selected.runtimeResolution?.preference ?? "legacy"} />
              <Row label="Model" value={selected.capability.modelPreference ?? "default"} />
              <Row label="Permission" value={selected.capability.permissionMode} />
              <Row label="Effort" value={selected.capability.reasoningEffort ?? "default"} />
              <Row label="Speed" value={selected.capability.speedPreference ?? "standard"} />
              <Row label="Worktree" value={selected.capability.worktreeStrategy} />
              <Row label="Skills" value={selected.capability.skills.join(", ") || "none"} />
            </dl>
          ) : null}
          {selected?.personality ? (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Personality {selected.personality.ref.personalityId}@
              {selected.personality.ref.version}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  )
}
