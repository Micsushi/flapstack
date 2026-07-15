"use client"

import { useAtom, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import {
  agentsLoginModalOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  anthropicOnboardingCompletedAtom,
  type SettingsTab,
} from "../../lib/atoms"
import { appStore } from "../../lib/jotai-store"
import { trpc } from "../../lib/trpc"
import { ClaudeLocalAuthPanel } from "../claude-local-auth-panel"
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"
import { ClaudeCodeIcon } from "../ui/icons"
import { Logo } from "../ui/logo"

type ClaudeLoginModalProps = {
  hideCustomModelSettingsLink?: boolean
  autoStartAuth?: boolean
}

export function ClaudeLoginModal({
  hideCustomModelSettingsLink = false,
  autoStartAuth = false,
}: ClaudeLoginModalProps) {
  const [open, setOpen] = useAtom(agentsLoginModalOpenAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const trpcUtils = trpc.useUtils()

  // Helper to trigger retry after successful OAuth
  const triggerAuthRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending && pending.provider === "claude-code") {
      console.log(
        "[ClaudeLoginModal] OAuth success - triggering retry for subChatId:",
        pending.subChatId,
      )
      appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
    }
  }

  // Helper to clear pending retry (on cancel/close without success)
  const clearPendingRetry = () => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending && pending.provider === "claude-code" && !pending.readyToRetry) {
      console.log("[ClaudeLoginModal] Modal closed without success - clearing pending retry")
      appStore.set(pendingAuthRetryMessageAtom, null)
    }
  }

  const handleAuthSuccess = () => {
    triggerAuthRetry()
    setAnthropicOnboardingCompleted(true)
    setOpen(false)
    void Promise.allSettled([
      trpcUtils.anthropicAccounts.list.invalidate(),
      trpcUtils.anthropicAccounts.getActive.invalidate(),
      trpcUtils.claudeCode.getIntegration.invalidate(),
    ])
  }

  const handleOpenModelsSettings = () => {
    clearPendingRetry()
    setSettingsActiveTab("models" as SettingsTab)
    setSettingsOpen(true)
    setOpen(false)
  }

  // Handle modal open/close - clear pending retry if closing without success
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      clearPendingRetry()
    }
    setOpen(newOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[440px] p-6">
        {/* Close button */}
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="space-y-8">
          {/* Header with dual icons */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div className="w-10 h-10 rounded-full bg-[#D97757] flex items-center justify-center">
                <ClaudeCodeIcon className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">Claude Code</h1>
              <p className="text-sm text-muted-foreground">Connect your Claude Code subscription</p>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6">
            <ClaudeLocalAuthPanel
              active={open}
              autoStart={autoStartAuth}
              onSuccess={handleAuthSuccess}
            />

            {!hideCustomModelSettingsLink && (
              <div className="text-center !mt-2">
                <button
                  type="button"
                  onClick={handleOpenModelsSettings}
                  className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Manage Claude accounts in Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
