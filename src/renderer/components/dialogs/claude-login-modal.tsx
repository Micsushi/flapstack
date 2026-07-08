"use client"

import { useAtom, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
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
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"
import { Button } from "../ui/button"
import { ClaudeCodeIcon, IconSpinner } from "../ui/icons"
import { Logo } from "../ui/logo"

type AuthFlowState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "terminal_open"; terminal: string }
  | { step: "checking" }
  | { step: "error"; message: string }

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
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const didAutoStartForOpenRef = useRef(false)

  // tRPC mutations
  const startLocalCliAuthMutation = trpc.claudeCode.startLocalCliAuth.useMutation()
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation()
  const trpcUtils = trpc.useUtils()

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setFlowState({ step: "idle" })
      didAutoStartForOpenRef.current = false
      // Clear pending retry if modal closed without success (user cancelled)
      // Note: We don't clear here because success handler sets readyToRetry=true first
    }
  }, [open])

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

  const handleConnectClick = useCallback(async () => {
    setFlowState({ step: "starting" })
    try {
      const result = await startLocalCliAuthMutation.mutateAsync()
      setFlowState({ step: "terminal_open", terminal: result.terminal })
      toast.info("Claude auth opened", {
        description: `Finish the Claude Code login in ${result.terminal}, then click Check connection.`,
      })
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to open Claude authentication",
      })
    }
  }, [startLocalCliAuthMutation])

  useEffect(() => {
    if (!open || !autoStartAuth || flowState.step !== "idle" || didAutoStartForOpenRef.current) {
      return
    }

    didAutoStartForOpenRef.current = true
    void handleConnectClick()
  }, [autoStartAuth, flowState.step, handleConnectClick, open])

  const handleCheckConnection = async () => {
    setFlowState({ step: "checking" })
    try {
      await importSystemTokenMutation.mutateAsync()
      toast.success("Claude Code connected")
      handleAuthSuccess()
    } catch (err) {
      setFlowState({
        step: "error",
        message:
          err instanceof Error
            ? err.message
            : "Claude credentials were not found yet. Finish the terminal login, then check again.",
      })
    }
  }

  const handleOpenModelsSettings = () => {
    clearPendingRetry()
    setSettingsActiveTab("models" as SettingsTab)
    setSettingsOpen(true)
    setOpen(false)
  }

  const isLoadingAuth = flowState.step === "starting"
  const isChecking = flowState.step === "checking"

  // Handle modal open/close - clear pending retry if closing without success
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      clearPendingRetry()
    }
    setOpen(newOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
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
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Flapstack will open your local terminal and run Claude Code authentication there.
              After it finishes, return here and check the connection.
            </div>

            {(flowState.step === "idle" || flowState.step === "starting") && (
              <Button onClick={handleConnectClick} className="w-full" disabled={isLoadingAuth}>
                {isLoadingAuth ? <IconSpinner className="h-4 w-4" /> : "Start Claude login"}
              </Button>
            )}

            {(flowState.step === "terminal_open" || flowState.step === "checking") && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background p-3 text-sm">
                  Claude login is running in{" "}
                  {flowState.step === "terminal_open" ? flowState.terminal : "Terminal"}.
                </div>
                <Button onClick={handleCheckConnection} className="w-full" disabled={isChecking}>
                  {isChecking ? <IconSpinner className="h-4 w-4" /> : "Check connection"}
                </Button>
              </div>
            )}

            {/* Error State */}
            {flowState.step === "error" && (
              <div className="space-y-4">
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{flowState.message}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={handleConnectClick}>
                    Start login
                  </Button>
                  <Button onClick={handleCheckConnection}>Check connection</Button>
                </div>
              </div>
            )}

            {!hideCustomModelSettingsLink && (
              <div className="text-center !mt-2">
                <button
                  type="button"
                  onClick={handleOpenModelsSettings}
                  className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Set a custom model in Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
