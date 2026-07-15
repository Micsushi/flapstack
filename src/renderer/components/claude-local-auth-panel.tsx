"use client"

import { CheckCircle2, ExternalLink, ShieldCheck, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc } from "../lib/trpc"
import { Button } from "./ui/button"
import { IconSpinner } from "./ui/icons"
import { Input } from "./ui/input"

type ClaudeLocalAuthPanelProps = {
  active?: boolean
  autoStart?: boolean
  onSuccess: () => void
}

export function ClaudeLocalAuthPanel({
  active = true,
  autoStart = false,
  onSuccess,
}: ClaudeLocalAuthPanelProps) {
  const [flowId, setFlowId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const autoStartedRef = useRef(false)
  const successHandledRef = useRef(false)
  const flowIdRef = useRef<string | null>(null)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  flowIdRef.current = flowId

  const startMutation = trpc.claudeCode.startLocalCliAuth.useMutation()
  const submitCodeMutation = trpc.claudeCode.submitLocalCliAuthCode.useMutation()
  const openBrowserMutation = trpc.claudeCode.openLocalCliAuthBrowser.useMutation()
  const cancelMutation = trpc.claudeCode.cancelLocalCliAuth.useMutation()
  const cancelMutationRef = useRef(cancelMutation)
  cancelMutationRef.current = cancelMutation
  const statusQuery = trpc.claudeCode.getLocalCliAuthStatus.useQuery(
    { flowId: flowId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: active && Boolean(flowId), refetchInterval: 500, retry: false },
  )

  const cancelFlow = useCallback(async () => {
    const currentFlowId = flowIdRef.current
    flowIdRef.current = null
    setFlowId(null)
    setCode("")
    setError(null)
    successHandledRef.current = false
    if (currentFlowId) {
      await cancelMutationRef.current.mutateAsync({ flowId: currentFlowId }).catch(() => undefined)
    }
  }, [])

  const startFlow = useCallback(async () => {
    const previousFlowId = flowIdRef.current
    if (previousFlowId) {
      await cancelMutationRef.current.mutateAsync({ flowId: previousFlowId }).catch(() => undefined)
    }
    setError(null)
    setCode("")
    successHandledRef.current = false
    try {
      const result = await startMutation.mutateAsync()
      flowIdRef.current = result.flowId
      setFlowId(result.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Claude login")
    }
  }, [startMutation])

  useEffect(() => {
    const status = statusQuery.data
    if (!status || successHandledRef.current) return
    if (status.state === "success") {
      successHandledRef.current = true
      flowIdRef.current = null
      setFlowId(null)
      toast.success("Claude Code connected")
      onSuccessRef.current()
    } else if (status.state === "error") {
      setError(status.message)
      flowIdRef.current = null
      setFlowId(null)
    }
  }, [statusQuery.data])

  useEffect(() => {
    if (!active) {
      autoStartedRef.current = false
      void cancelFlow()
      return
    }
    if (autoStart && !autoStartedRef.current && !flowId && !startMutation.isPending) {
      autoStartedRef.current = true
      void startFlow()
    }
  }, [active, autoStart, cancelFlow, flowId, startFlow, startMutation.isPending])

  useEffect(
    () => () => {
      const currentFlowId = flowIdRef.current
      if (currentFlowId) {
        cancelMutationRef.current.mutate({ flowId: currentFlowId })
      }
    },
    [],
  )

  const status = statusQuery.data
  const isStarting = startMutation.isPending || (flowId && !status)
  const isVerifying = status?.state === "verifying"
  const isActiveFlow = Boolean(flowId) && !error

  const handleSubmitCode = async () => {
    if (!flowId || !code.trim()) return
    try {
      await submitCodeMutation.mutateAsync({ flowId, code: code.trim() })
      setCode("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the authorization code")
    }
  }

  const handleOpenBrowser = async () => {
    if (!flowId) return
    try {
      await openBrowserMutation.mutateAsync({ flowId })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Claude sign-in")
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
        <Button className="w-full" onClick={() => void startFlow()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!isActiveFlow && !isStarting) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#D97757]" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Private browser sign-in</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Flapstack runs Claude&apos;s login helper in the background. Your browser handles the
              account sign-in; no Terminal window opens.
            </p>
          </div>
        </div>
        <Button className="w-full" onClick={() => void startFlow()}>
          Connect Claude Code
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
        {isVerifying ? (
          <IconSpinner className="mt-0.5 h-5 w-5 shrink-0" />
        ) : status?.state === "success" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        ) : (
          <ExternalLink className="mt-0.5 h-5 w-5 shrink-0 text-[#D97757]" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {isStarting ? "Opening Claude sign-in…" : "Complete sign-in in your browser"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {status?.message ?? "Starting Claude's secure browser login…"}
          </p>
        </div>
      </div>

      {!isVerifying && !isStarting && (
        <div className="space-y-2">
          <label htmlFor="claude-auth-code" className="text-xs font-medium text-foreground">
            Authorization code <span className="font-normal text-muted-foreground">(if shown)</span>
          </label>
          <div className="flex gap-2">
            <Input
              id="claude-auth-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSubmitCode()
              }}
              placeholder="Paste code from Claude"
              autoComplete="off"
            />
            <Button
              onClick={() => void handleSubmitCode()}
              disabled={!code.trim() || submitCodeMutation.isPending}
            >
              {submitCodeMutation.isPending ? <IconSpinner className="h-4 w-4" /> : "Submit"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Most sign-ins finish automatically. Paste a code only when Claude asks for one.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {status?.oauthUrl && !isVerifying && (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => void handleOpenBrowser()}
            disabled={openBrowserMutation.isPending}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open browser again
          </Button>
        )}
        <Button variant="ghost" className="flex-1" onClick={() => void cancelFlow()}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
