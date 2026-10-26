import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { MoreHorizontal, Plus, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  agentsLoginModalOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  claudeLoginModalConfigAtom,
  codexLoginModalMethodAtom,
  codexLoginModalOpenAtom,
  hiddenModelsAtom,
} from "../../../lib/atoms"
import { enabledCursorModelsAtom } from "../../../features/agents/atoms"
import { ClaudeCodeIcon, CodexIcon, CursorIcon, SearchIcon } from "../../ui/icons"
import { CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS } from "../../../features/agents/lib/models"
import { trpc } from "../../../lib/trpc"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { Switch } from "../../ui/switch"
import { RenameDialog } from "../../rename-dialog"
import { useIsNarrowScreen } from "./use-is-narrow-screen"

// Account row component
function AccountRow({
  account,
  isActive,
  onSetActive,
  onRename,
  onRemove,
  isLoading,
}: {
  account: {
    id: string
    displayName: string | null
    email: string | null
    connectedAt: string | null
  }
  isActive: boolean | null
  onSetActive: () => void
  onRename: () => void
  onRemove: () => void
  isLoading: boolean
}) {
  return (
    <div className="flex items-center justify-between p-3 hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-sm font-medium">{account.displayName || "Anthropic Account"}</div>
          {account.email && <div className="text-xs text-muted-foreground">{account.email}</div>}
          {!account.email && account.connectedAt && (
            <div className="text-xs text-muted-foreground">
              Connected{" "}
              {new Date(account.connectedAt).toLocaleDateString(undefined, {
                dateStyle: "short",
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isActive === null ? (
          <Badge variant="outline" className="text-xs">
            Status unavailable
          </Badge>
        ) : !isActive ? (
          <Button size="sm" variant="ghost" onClick={onSetActive} disabled={isLoading}>
            Switch
          </Button>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Active
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              className="data-[highlighted]:bg-red-500/15 data-[highlighted]:text-red-400"
              onClick={onRemove}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// Anthropic accounts section component
function AnthropicAccountsSection() {
  const [renamingAccount, setRenamingAccount] = useState<{
    id: string
    name: string
  } | null>(null)
  const {
    data: accounts,
    isLoading: isAccountsLoading,
    isFetching: isAccountsFetching,
    isError: isAccountsError,
    error: accountsError,
    refetch: refetchList,
  } = trpc.anthropicAccounts.list.useQuery(undefined, {
    refetchOnMount: true,
    staleTime: 0,
  })
  const {
    data: activeAccount,
    isLoading: isActiveAccountLoading,
    isFetching: isActiveAccountFetching,
    error: activeAccountError,
    refetch: refetchActive,
  } = trpc.anthropicAccounts.getActive.useQuery(undefined, {
    refetchOnMount: true,
    staleTime: 0,
  })
  const {
    data: claudeCodeIntegration,
    isLoading: isClaudeCodeLoading,
    isFetching: isClaudeCodeFetching,
    error: claudeCodeIntegrationError,
    refetch: refetchClaudeCodeIntegration,
  } = trpc.claudeCode.getIntegration.useQuery()
  const trpcUtils = trpc.useUtils()

  const accountReadError = accountsError ?? activeAccountError ?? claudeCodeIntegrationError
  const isRefreshingAccountReads =
    isAccountsFetching || isActiveAccountFetching || isClaudeCodeFetching
  const retryAccountReads = async () => {
    await Promise.all([refetchList(), refetchActive(), refetchClaudeCodeIntegration()])
  }

  // Auto-migrate legacy account if needed
  const migrateLegacy = trpc.anthropicAccounts.migrateLegacy.useMutation({
    onSuccess: async () => {
      await refetchList()
      await refetchActive()
    },
  })

  // Trigger migration if: no accounts, not loading, has legacy connection, not already migrating
  useEffect(() => {
    if (
      !isAccountsLoading &&
      accounts?.length === 0 &&
      claudeCodeIntegration?.isConnected &&
      !migrateLegacy.isPending &&
      !migrateLegacy.isSuccess
    ) {
      migrateLegacy.mutate()
    }
  }, [isAccountsLoading, accounts, claudeCodeIntegration, migrateLegacy])

  const setActiveMutation = trpc.anthropicAccounts.setActive.useMutation({
    onSuccess: () => {
      trpcUtils.anthropicAccounts.list.invalidate()
      trpcUtils.anthropicAccounts.getActive.invalidate()
      trpcUtils.claudeCode.getIntegration.invalidate()
      toast.success("Account switched")
    },
    onError: (err) => {
      toast.error(`Failed to switch account: ${err.message}`)
    },
  })

  const renameMutation = trpc.anthropicAccounts.rename.useMutation({
    onSuccess: () => {
      trpcUtils.anthropicAccounts.list.invalidate()
      trpcUtils.anthropicAccounts.getActive.invalidate()
      toast.success("Account renamed")
    },
    onError: (err) => {
      toast.error(`Failed to rename account: ${err.message}`)
    },
  })

  const removeMutation = trpc.anthropicAccounts.remove.useMutation({
    onSuccess: () => {
      trpcUtils.anthropicAccounts.list.invalidate()
      trpcUtils.anthropicAccounts.getActive.invalidate()
      trpcUtils.claudeCode.getIntegration.invalidate()
      toast.success("Account removed")
    },
    onError: (err) => {
      toast.error(`Failed to remove account: ${err.message}`)
    },
  })

  const handleRename = (accountId: string, currentName: string | null) => {
    setRenamingAccount({ id: accountId, name: currentName || "Anthropic Account" })
  }

  const handleRenameSave = async (displayName: string) => {
    if (!renamingAccount) return
    await renameMutation.mutateAsync({ accountId: renamingAccount.id, displayName })
    setRenamingAccount(null)
  }

  const handleRemove = (accountId: string, displayName: string | null) => {
    const confirmed = window.confirm(
      `Are you sure you want to remove "${displayName || "this account"}"? You will need to re-authenticate to use it again.`,
    )
    if (confirmed) {
      removeMutation.mutate({ accountId })
    }
  }

  const isLoading =
    setActiveMutation.isPending || renameMutation.isPending || removeMutation.isPending

  // Don't show section if no accounts
  if (
    !isAccountsLoading &&
    !isAccountsError &&
    !activeAccountError &&
    !claudeCodeIntegrationError &&
    (!accounts || accounts.length === 0)
  ) {
    return null
  }

  return (
    <>
      <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
        {isAccountsLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading accounts...</div>
        ) : isAccountsError ? (
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-xs text-destructive" role="alert">
              Anthropic accounts unavailable: {accountsError?.message ?? "Unknown error"}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={isRefreshingAccountReads}
              onClick={() => void retryAccountReads()}
            >
              <RefreshCw
                className={
                  isRefreshingAccountReads ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"
                }
                aria-hidden="true"
              />{" "}
              Retry account reads
            </Button>
          </div>
        ) : (
          <>
            {accountReadError && (
              <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/5 p-4">
                <p className="text-xs text-destructive" role="alert">
                  Anthropic account status unavailable: {accountReadError.message}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRefreshingAccountReads}
                  onClick={() => void retryAccountReads()}
                >
                  <RefreshCw
                    className={
                      isRefreshingAccountReads
                        ? "mr-2 h-3.5 w-3.5 animate-spin"
                        : "mr-2 h-3.5 w-3.5"
                    }
                    aria-hidden="true"
                  />{" "}
                  Retry status
                </Button>
              </div>
            )}
            {accounts?.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                isActive={activeAccountError ? null : activeAccount?.id === account.id}
                onSetActive={() => setActiveMutation.mutate({ accountId: account.id })}
                onRename={() => handleRename(account.id, account.displayName)}
                onRemove={() => handleRemove(account.id, account.displayName)}
                isLoading={isLoading || isActiveAccountLoading}
              />
            ))}
          </>
        )}
      </div>

      <RenameDialog
        isOpen={Boolean(renamingAccount)}
        onClose={() => setRenamingAccount(null)}
        onSave={handleRenameSave}
        currentName={renamingAccount?.name ?? ""}
        isLoading={renameMutation.isPending}
        title="Rename account"
        placeholder="Account name"
      />
    </>
  )
}

export function AgentsModelsTab() {
  const setClaudeLoginModalConfig = useSetAtom(claudeLoginModalConfigAtom)
  const setClaudeLoginModalOpen = useSetAtom(agentsLoginModalOpenAtom)
  const setCodexLoginModalOpen = useSetAtom(codexLoginModalOpenAtom)
  const setCodexLoginModalMethod = useSetAtom(codexLoginModalMethodAtom)
  const setActiveSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const isNarrowScreen = useIsNarrowScreen()
  const {
    data: claudeCodeIntegration,
    isLoading: isClaudeCodeLoading,
    error: claudeCodeIntegrationError,
  } = trpc.claudeCode.getIntegration.useQuery()
  const isClaudeCodeConnected = claudeCodeIntegration?.isConnected
  const {
    data: codexIntegration,
    isLoading: isCodexLoading,
    isFetching: isCodexFetching,
    error: codexIntegrationError,
    refetch: refetchCodexIntegration,
  } = trpc.codex.getIntegration.useQuery()

  const {
    data: codexCredentialStatus,
    isLoading: isCodexCredentialLoading,
    error: codexCredentialError,
    refetch: refetchCodexCredential,
  } = trpc.credentials.status.useQuery({ id: "codex.api-key" })
  const codexLogoutMutation = trpc.codex.logout.useMutation()
  const trpcUtils = trpc.useUtils()

  const handleClaudeCodeSetup = () => {
    setClaudeLoginModalConfig({
      hideCustomModelSettingsLink: true,
      autoStartAuth: true,
    })
    setClaudeLoginModalOpen(true)
  }

  const handleCodexSetup = (method: "chatgpt" | "api_key") => {
    setCodexLoginModalMethod(method)
    setCodexLoginModalOpen(true)
  }

  const handleCodexLogout = async () => {
    const confirmed = window.confirm("Log out from Codex on this device?")
    if (!confirmed) return

    try {
      await codexLogoutMutation.mutateAsync()
      await trpcUtils.codex.getIntegration.invalidate()
      toast.success("Codex disconnected")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect Codex"
      toast.error(message)
    }
  }

  const hasAppCodexApiKey = codexCredentialStatus?.configured === true
  const codexCredentialStatusUnavailable = isCodexCredentialLoading || Boolean(codexCredentialError)
  const isCodexSubscriptionConnected = codexIntegration?.state === "connected_chatgpt"
  const isCodexSubscriptionActive = isCodexSubscriptionConnected && !hasAppCodexApiKey
  const [hiddenModels, setHiddenModels] = useAtom(hiddenModelsAtom)
  const [enabledCursorModels, setEnabledCursorModels] = useAtom(enabledCursorModelsAtom)
  const {
    data: cursorModelData,
    isFetching: isCursorModelsFetching,
    error: cursorModelsError,
    refetch: refetchCursorModels,
  } = trpc.cursor.listModels.useQuery()

  const toggleModelVisibility = useCallback(
    (modelId: string, provider: "claude" | "codex" | "cursor") => {
      if (provider === "cursor") {
        setEnabledCursorModels((current) => {
          if (!current.includes(modelId)) return [...current, modelId]
          if (current.length === 1) {
            toast.error("Cursor needs at least one enabled model")
            return current
          }
          return current.filter((id) => id !== modelId)
        })
        return
      }
      setHiddenModels((prev) => {
        if (prev.includes(modelId)) {
          return prev.filter((id) => id !== modelId)
        }
        return [...prev, modelId]
      })
    },
    [setEnabledCursorModels, setHiddenModels],
  )

  const codexConnectionText = isCodexSubscriptionConnected
    ? "Connected via ChatGPT"
    : codexIntegration?.state === "connected_api_key"
      ? "Not connected to subscription"
      : codexIntegration?.state === "not_logged_in"
        ? "Not connected"
        : "Status unavailable"
  const showCodexLoading = isCodexLoading && !hasAppCodexApiKey

  // All models merged into one list for the top section
  const allModels = useMemo(() => {
    const items: { id: string; name: string; provider: "claude" | "codex" | "cursor" }[] = []
    for (const m of CLAUDE_MODELS) {
      items.push({ id: m.id, name: `${m.name} ${m.version}`, provider: "claude" })
    }
    for (const m of CODEX_MODELS) {
      items.push({ id: m.id, name: m.name, provider: "codex" })
    }
    const cursorIds = cursorModelData?.models?.length
      ? cursorModelData.models
      : CURSOR_MODELS.map((model) => model.id)
    for (const id of cursorIds) {
      items.push({
        id,
        name: CURSOR_MODELS.find((model) => model.id === id)?.name ?? id,
        provider: "cursor",
      })
    }
    return items
  }, [cursorModelData?.models])

  const [modelSearch, setModelSearch] = useState("")
  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return allModels
    const q = modelSearch.toLowerCase().trim()
    return allModels.filter((m) => m.name.toLowerCase().includes(q))
  }, [allModels, modelSearch])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Models</h3>
        </div>
      )}

      {/* ===== Models Section ===== */}
      <div className="space-y-2">
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {/* Search */}
          <div className="px-1.5 pt-1.5 pb-0.5">
            <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md bg-muted/50">
              <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Add or search model"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Model list */}
          {cursorModelsError && (
            <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/5 px-4 py-2">
              <p className="text-xs text-destructive" role="alert">
                Cursor model catalog unavailable: {cursorModelsError.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isCursorModelsFetching}
                onClick={() => void refetchCursorModels()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry models
              </Button>
            </div>
          )}
          <div className="divide-y divide-border">
            {filteredModels.map((m) => {
              const isEnabled =
                m.provider === "cursor"
                  ? enabledCursorModels.includes(m.id)
                  : !hiddenModels.includes(m.id)
              return (
                <div key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.name}</span>
                    {m.provider === "claude" ? (
                      <ClaudeCodeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : m.provider === "cursor" ? (
                      <CursorIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <CodexIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <Switch
                    checked={isEnabled}
                    disabled={m.provider === "cursor" && isCursorModelsFetching}
                    onCheckedChange={() => toggleModelVisibility(m.id, m.provider)}
                  />
                </div>
              )
            })}
            {filteredModels.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No models found
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Accounts Section ===== */}
      <div className="space-y-2">
        {/* Anthropic Accounts */}
        <div className="pb-2 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-foreground">Anthropic Accounts</h4>
            <p className="text-xs text-muted-foreground">
              Manage Anthropic accounts used by Claude Code
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClaudeCodeSetup}
            disabled={isClaudeCodeLoading || Boolean(claudeCodeIntegrationError)}
          >
            <Plus className="h-3 w-3 mr-1" />
            {claudeCodeIntegrationError ? "Unavailable" : isClaudeCodeConnected ? "Add" : "Connect"}
          </Button>
        </div>

        <AnthropicAccountsSection />
      </div>

      <div className="space-y-2">
        <div className="pb-2 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-foreground">Codex Account</h4>
            <p className="text-xs text-muted-foreground">Manage your Codex account</p>
          </div>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
          {codexIntegrationError && (
            <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/5 p-4">
              <p className="text-xs text-destructive" role="alert">
                Codex account status unavailable: {codexIntegrationError.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isCodexFetching}
                onClick={() => void refetchCodexIntegration()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry status
              </Button>
            </div>
          )}
          {codexCredentialError && (
            <div className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/5 p-4">
              <p className="text-xs text-destructive" role="alert">
                Codex API key status unavailable: {codexCredentialError.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isCodexCredentialLoading}
                onClick={() => void refetchCodexCredential()}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry credentials
              </Button>
            </div>
          )}
          {showCodexLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading account...</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-6 p-4 hover:bg-muted/50">
                <div>
                  <div className="text-sm font-medium">Codex Subscription</div>
                  <div className="text-xs text-muted-foreground">{codexConnectionText}</div>
                </div>

                <div className="flex items-center gap-2">
                  {isCodexSubscriptionActive && (
                    <Badge variant="secondary" className="text-xs">
                      Active
                    </Badge>
                  )}
                  {isCodexSubscriptionConnected ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleCodexLogout()}
                      disabled={codexLogoutMutation.isPending}
                    >
                      {codexLogoutMutation.isPending ? "..." : "Logout"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCodexSetup("chatgpt")}
                      disabled={isCodexLoading || codexLogoutMutation.isPending}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-6 p-4 hover:bg-muted/50">
                <div>
                  <div className="text-sm font-medium">Codex API key</div>
                  <div className="text-xs text-muted-foreground">
                    {codexCredentialStatusUnavailable
                      ? "Status unavailable"
                      : hasAppCodexApiKey
                        ? "Configured in Flapstack"
                        : "Not configured"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {hasAppCodexApiKey && (
                    <Badge variant="secondary" className="text-xs">
                      Active
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveSettingsTab("api-providers")}
                    disabled={codexCredentialStatusUnavailable}
                  >
                    Manage
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
