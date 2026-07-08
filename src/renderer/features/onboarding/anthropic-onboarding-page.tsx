"use client"

import { useSetAtom } from "jotai"
import { ChevronLeft } from "lucide-react"
import { useState } from "react"

import { ClaudeCodeIcon, IconSpinner } from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { anthropicOnboardingCompletedAtom, billingMethodAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"

type AuthFlowState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "terminal_open"; terminal: string }
  | { step: "checking" }
  | { step: "error"; message: string }

export function AnthropicOnboardingPage() {
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const startLocalCliAuthMutation = trpc.claudeCode.startLocalCliAuth.useMutation()
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation()

  const handleBack = () => {
    setBillingMethod(null)
  }

  const handleConnectClick = async () => {
    setFlowState({ step: "starting" })
    try {
      const result = await startLocalCliAuthMutation.mutateAsync()
      setFlowState({ step: "terminal_open", terminal: result.terminal })
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to open Claude authentication",
      })
    }
  }

  const handleCheckConnection = async () => {
    setFlowState({ step: "checking" })
    try {
      await importSystemTokenMutation.mutateAsync()
      setAnthropicOnboardingCompleted(true)
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

  const isStarting = flowState.step === "starting"
  const isChecking = flowState.step === "checking"

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <button
        onClick={handleBack}
        className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="w-full max-w-[440px] space-y-8 px-4">
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
            <h1 className="text-base font-semibold tracking-tight">Connect Claude Code</h1>
            <p className="text-sm text-muted-foreground">
              Connect your local Claude Code subscription to get started
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Flapstack will open your local terminal and run Claude Code authentication there. After
            it finishes, return here and check the connection.
          </div>

          {(flowState.step === "idle" || flowState.step === "starting") && (
            <button
              onClick={handleConnectClick}
              disabled={isStarting}
              className="h-8 w-full px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isStarting ? <IconSpinner className="h-4 w-4" /> : "Start Claude login"}
            </button>
          )}

          {(flowState.step === "terminal_open" || flowState.step === "checking") && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-background p-3 text-sm">
                Claude login is running in{" "}
                {flowState.step === "terminal_open" ? flowState.terminal : "Terminal"}.
              </div>
              <button
                onClick={handleCheckConnection}
                disabled={isChecking}
                className="h-8 w-full px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isChecking ? <IconSpinner className="h-4 w-4" /> : "Check connection"}
              </button>
            </div>
          )}

          {flowState.step === "error" && (
            <div className="space-y-3">
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{flowState.message}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleConnectClick}
                  className="h-8 px-3 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] flex items-center justify-center"
                >
                  Start login
                </button>
                <button
                  onClick={handleCheckConnection}
                  className="h-8 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] flex items-center justify-center"
                >
                  Check connection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
