"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"

import { IconSpinner, KeyFilledIcon, SettingsFilledIcon } from "../../components/ui/icons"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Logo } from "../../components/ui/logo"
import { apiKeyOnboardingCompletedAtom, billingMethodAtom } from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"

// Check if the key looks like a valid Anthropic API key
const isValidApiKey = (key: string) => {
  const trimmed = key.trim()
  return trimmed.startsWith("sk-ant-") && trimmed.length > 20
}

export function ApiKeyOnboardingPage() {
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)

  const isCustomModel = billingMethod === "custom-model"

  // Default values for API key mode (not custom model)
  const defaultModel = "claude-sonnet-5"
  const defaultBaseUrl = "https://api.anthropic.com"

  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [token, setToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const setCredential = trpc.credentials.set.useMutation()
  const utils = trpc.useUtils()

  const busy = useRef(false)
  const secretInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNeeded, setRefreshNeeded] = useState(false)

  const finishRequest = () => {
    busy.current = false
    if (mounted.current) setIsSubmitting(false)
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) secretInput.current?.focus()
    })
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [billingMethod])

  const handleBack = () => {
    generation.current += 1
    setBillingMethod(null)
  }

  const refreshStatus = async (requestGeneration: number) => {
    try {
      await utils.credentials.status.invalidate({ id: "claude.custom-api-token" }, undefined, {
        throwOnError: true,
      })
      if (generation.current !== requestGeneration) return
      setRefreshNeeded(false)
      setError(null)
      setApiKeyOnboardingCompleted(true)
    } catch {
      if (generation.current !== requestGeneration) return
      setRefreshNeeded(true)
      setError("Credential saved, but its status could not be refreshed.")
    }
  }

  const submit = async () => {
    if (busy.current || refreshNeeded) return
    const secret = isCustomModel ? token : apiKey
    if (isCustomModel ? !model.trim() || !secret.trim() || !baseUrl.trim() : !isValidApiKey(secret))
      return
    busy.current = true
    setIsSubmitting(true)
    setError(null)
    const requestGeneration = generation.current
    try {
      const status = await setCredential.mutateAsync({
        id: "claude.custom-api-token",
        secret: secret.trim(),
        metadata: isCustomModel
          ? { model: model.trim(), baseUrl: baseUrl.trim() }
          : { model: defaultModel, baseUrl: defaultBaseUrl },
      })
      if (generation.current !== requestGeneration) return
      setSaved(true)
      if (isCustomModel) setToken("")
      else setApiKey("")
      if (status.persistence === "session") {
        toast.warning("Credential is available for this session only", {
          description: status.warning,
        })
      }
      await refreshStatus(requestGeneration)
    } catch (error) {
      if (generation.current === requestGeneration) {
        setError(error instanceof Error ? error.message : "Could not save the credential.")
      }
    } finally {
      finishRequest()
    }
  }

  const retryStatus = async () => {
    if (busy.current || !saved) return
    busy.current = true
    setIsSubmitting(true)
    try {
      await refreshStatus(generation.current)
    } finally {
      finishRequest()
    }
  }

  const feedback = (
    <>
      {saved && !refreshNeeded && (
        <p role="status" className="text-sm">
          Credential saved.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400 break-words">
          {error}
        </p>
      )}
      {refreshNeeded && (
        <Button type="button" disabled={isSubmitting} onClick={() => void retryStatus()}>
          Retry status
        </Button>
      )}
    </>
  )

  const canSubmitCustomModel = Boolean(model.trim() && token.trim() && baseUrl.trim())

  // Simple API key input mode
  if (!isCustomModel) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
        {/* Draggable title bar area */}
        <div
          className="fixed top-0 left-0 right-0 h-10"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Back button - fixed in top left corner below traffic lights */}
        <button
          aria-label="Back to connection methods"
          onClick={handleBack}
          className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="w-full max-w-[440px] space-y-8 px-4">
          {/* Header with dual icons */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <KeyFilledIcon className="w-5 h-5 text-background" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">Enter API Key</h1>
              <p className="text-sm text-muted-foreground">
                Get your API key from{" "}
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-4">
            <div className="relative">
              <Input
                ref={secretInput}
                readOnly={isSubmitting || refreshNeeded}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void submit()
                  }
                }}
                type="password"
                autoComplete="new-password"
                aria-label="Anthropic API key"
                placeholder="sk-ant-..."
                className="font-mono text-center pr-10"
                autoFocus
              />
              {isSubmitting && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <IconSpinner className="h-4 w-4" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Your API key starts with sk-ant-
            </p>
            {feedback}
            <Button
              className="w-full"
              disabled={!isValidApiKey(apiKey) || isSubmitting || refreshNeeded}
              onClick={() => void submit()}
            >
              {isSubmitting ? "Saving..." : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Custom model mode with all fields
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Back button - fixed in top left corner below traffic lights */}
      <button
        aria-label="Back to connection methods"
        onClick={handleBack}
        className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="w-full max-w-[440px] space-y-8 px-4">
        {/* Header with dual icons */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5" fill="white" />
            </div>
            <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
              <SettingsFilledIcon className="w-5 h-5 text-background" />
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold tracking-tight">Configure Custom Model</h1>
            <p className="text-sm text-muted-foreground">Enter your custom model configuration</p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-4">
          {/* Model Name */}
          <div className="space-y-2">
            <Label htmlFor="onboarding-model" className="text-sm font-medium">
              Model name
            </Label>
            <Input
              id="onboarding-model"
              readOnly={isSubmitting || refreshNeeded}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-5"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">Model identifier for API requests</p>
          </div>

          {/* API Token */}
          <div className="space-y-2">
            <Label htmlFor="onboarding-token" className="text-sm font-medium">
              API token
            </Label>
            <Input
              id="onboarding-token"
              ref={secretInput}
              type="password"
              readOnly={isSubmitting || refreshNeeded}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">Your API key or token</p>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="onboarding-url" className="text-sm font-medium">
              Base URL
            </Label>
            <Input
              id="onboarding-url"
              readOnly={isSubmitting || refreshNeeded}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">API endpoint URL</p>
          </div>
        </div>

        {feedback}
        {/* Continue Button */}
        <button
          onClick={() => void submit()}
          disabled={!canSubmitCustomModel || isSubmitting || refreshNeeded}
          className={cn(
            "w-full h-8 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center",
            (!canSubmitCustomModel || isSubmitting || refreshNeeded) &&
              "opacity-50 cursor-not-allowed",
          )}
        >
          {isSubmitting ? <IconSpinner className="h-4 w-4" /> : "Continue"}
        </button>
      </div>
    </div>
  )
}
