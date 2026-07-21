"use client"

import { useSetAtom } from "jotai"
import { ChevronLeft } from "lucide-react"

import { ClaudeLocalAuthPanel } from "../../components/claude-local-auth-panel"
import { ClaudeCodeIcon } from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { anthropicOnboardingCompletedAtom, billingMethodAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"

export function AnthropicOnboardingPage() {
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const utils = trpc.useUtils()

  const handleBack = () => {
    setBillingMethod(null)
  }

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

        <ClaudeLocalAuthPanel
          onSuccess={() => {
            setAnthropicOnboardingCompleted(true)
            void utils.claudeCode.getIntegration.invalidate()
          }}
        />
      </div>
    </div>
  )
}
