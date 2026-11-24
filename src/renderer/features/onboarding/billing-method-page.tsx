"use client"

import { useSetAtom } from "jotai"
import {
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  KeyRound,
  ScanLine,
  Sparkles,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ClaudeLocalAuthPanel } from "../../components/claude-local-auth-panel"
import { Button } from "../../components/ui/button"
import { ClaudeCodeIcon, CodexIcon } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { billingMethodAtom, normalizeCodexApiKey } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import { lastSelectedAgentIdAtom } from "../agents/atoms"
import { useCodexLoginFlow } from "../agents/hooks/use-codex-login-flow"
import cursorIcon from "../../assets/app-icons/cursor.svg"

const nativeProviders = [
  { id: "claude-code", name: "Claude Code", icon: <ClaudeCodeIcon className="size-5" /> },
  { id: "codex", name: "Codex", icon: <CodexIcon className="size-5" /> },
  {
    id: "antigravity",
    name: "Gemini via Antigravity",
    icon: <Sparkles className="size-5" />,
  },
  { id: "cursor-agent", name: "Cursor", icon: <img src={cursorIcon} alt="" className="size-5" /> },
] as const

type NativeProvider = (typeof nativeProviders)[number]["id"]
type ProviderState = "connected" | "key-saved" | "sign-in" | "missing" | "unknown" | "checking"
type KeyProvider = "openrouter" | "nanogpt" | "anthropic" | "openai" | "custom" | "cursor"

const stateLabels: Record<ProviderState, string> = {
  connected: "Connected",
  "key-saved": "Key saved",
  "sign-in": "Sign-in required",
  missing: "CLI not found",
  unknown: "Could not confirm",
  checking: "Checking…",
}

function providerState(
  status: string | undefined,
  failed: boolean,
  hasKey?: boolean,
): ProviderState {
  if (status === "connected") return "connected"
  if (status === "not_installed") return "missing"
  if (hasKey) return "key-saved"
  if (status === "not_logged_in") return "sign-in"
  return status || failed ? "unknown" : "checking"
}

const installLinks: Partial<Record<NativeProvider, string>> = {
  antigravity: "https://antigravity.google/docs/getting-started?tab=cli",
  "cursor-agent": "https://cursor.com/docs/cli/installation",
}

function CodexSignIn({ onConnected }: { onConnected: () => void }) {
  const flow = useCodexLoginFlow()
  const started = useRef(false)
  const callback = useRef(onConnected)
  callback.current = onConnected
  useEffect(() => {
    if (started.current) return
    started.current = true
    void flow.start()
  }, [flow.start])
  useEffect(() => {
    if (flow.state === "success") callback.current()
  }, [flow.state])
  if (flow.state === "error" || flow.state === "cancelled")
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {flow.error ?? "Codex sign-in ended."}
        </p>
        <Button size="sm" onClick={() => void flow.start()}>
          Try again
        </Button>
      </div>
    )
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-muted-foreground">
        Complete ChatGPT sign-in in your browser.
      </p>
      {flow.url && (
        <Button size="sm" variant="outline" onClick={() => void flow.openUrl()}>
          Open sign-in
        </Button>
      )}
    </div>
  )
}

function AntigravitySignIn({ onConnected }: { onConnected: () => void }) {
  const [loginId, setLoginId] = useState(() => crypto.randomUUID())
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const start = trpc.agentRuntimeChat.startAntigravitySignIn.useMutation()
  const cancel = trpc.agentRuntimeChat.cancelAntigravitySignIn.useMutation()
  const submit = trpc.agentRuntimeChat.submitAntigravitySignInCode.useMutation()
  const reopen = trpc.agentRuntimeChat.reopenAntigravitySignIn.useMutation()
  const status = trpc.agentRuntimeChat.antigravitySignInStatus.useQuery(
    { loginId },
    {
      enabled: start.isSuccess,
      retry: false,
      refetchInterval: (query) =>
        ["connected", "error", "unconfirmed"].includes(query.state.data?.state ?? "") ? false : 700,
    },
  )
  const started = useRef<string | undefined>(undefined)
  const startRef = useRef(start.mutate)
  const cancelRef = useRef(cancel.mutate)
  startRef.current = start.mutate
  cancelRef.current = cancel.mutate
  const done = useRef(onConnected)
  done.current = onConnected

  useEffect(() => {
    if (started.current === loginId) return
    started.current = loginId
    startRef.current({ loginId })
    return () => {
      started.current = undefined
      cancelRef.current({ loginId })
    }
  }, [loginId])

  useEffect(() => {
    if (status.data?.state === "connected") done.current()
  }, [status.data?.state])

  const state = status.data?.state
  if (start.isError || state === "error" || state === "unconfirmed" || status.isError) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Could not confirm Antigravity sign-in.
        </p>
        <Button
          size="sm"
          onClick={() => {
            start.reset()
            setError(undefined)
            setLoginId(crypto.randomUUID())
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-muted-foreground">
        {state === "verifying"
          ? "Checking Antigravity access..."
          : state === "waiting"
            ? "Sign in with Google, then paste the code from your browser."
            : "Opening Google sign-in..."}
      </p>
      {state === "waiting" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!code.trim() || submit.isPending) return
            setError(undefined)
            submit.mutate(
              { loginId, code: code.trim() },
              {
                onSuccess: () => {
                  setCode("")
                  void status.refetch()
                },
                onError: () => setError("Could not submit the Google sign-in code."),
              },
            )
          }}
        >
          <Label htmlFor="antigravity-login-code">Authorization code</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="antigravity-login-code"
              type="password"
              autoComplete="off"
              className="min-w-32 flex-1"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={submit.isPending || !code.trim()}>
              Submit code
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() =>
                reopen.mutate(
                  { loginId },
                  { onError: () => setError("Could not reopen Google sign-in.") },
                )
              }
            >
              Open browser
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function CursorSignIn({ onConnected }: { onConnected: () => void }) {
  const login = trpc.cursor.startLogin.useMutation()
  const cancel = trpc.cursor.cancelLogin.useMutation()
  const [loginId] = useState(() => crypto.randomUUID())
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState<string>()
  const status = trpc.cursor.getIntegration.useQuery(undefined, {
    enabled: waiting,
    refetchInterval: waiting ? 3000 : false,
    retry: false,
  })
  const startRef = useRef(login.mutate)
  const cancelRef = useRef(cancel.mutate)
  const callback = useRef(onConnected)
  startRef.current = login.mutate
  cancelRef.current = cancel.mutate
  callback.current = onConnected

  useEffect(() => {
    if (waiting && status.data?.isConnected) callback.current()
  }, [waiting, status.data?.isConnected])

  function connect() {
    setMessage(undefined)
    startRef.current(
      { loginId },
      {
        onSuccess: (result) => {
          if (result.started) setWaiting(true)
          else setMessage("Could not confirm that Cursor opened sign-in.")
        },
        onError: () => setMessage("Cursor could not start sign-in."),
      },
    )
  }
  const connectRef = useRef(connect)
  connectRef.current = connect
  useEffect(() => {
    connectRef.current()
    return () => cancelRef.current({ loginId })
  }, [loginId])

  return (
    <div className="space-y-2">
      <p role={message ? "alert" : "status"} className="text-sm text-muted-foreground">
        {message ??
          (waiting ? "Complete Cursor sign-in in your browser." : "Opening Cursor sign-in...")}
      </p>
      {message && (
        <Button size="sm" variant="outline" onClick={connect}>
          Try again
        </Button>
      )}
      {waiting && (
        <Button size="sm" variant="outline" onClick={() => void status.refetch()}>
          Check sign-in
        </Button>
      )}
    </div>
  )
}

function ProviderKeyForm({ provider, onSaved }: { provider: KeyProvider; onSaved: () => void }) {
  const credential = trpc.credentials.set.useMutation()
  const providerKey = trpc.opencode.setKey.useMutation()
  const cursorKey = trpc.usage.setSecret.useMutation()
  const [secret, setSecret] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [message, setMessage] = useState("")
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)

  async function save() {
    if (writing.current || !secret.trim()) return
    if (provider === "openai" && !normalizeCodexApiKey(secret)) {
      setFailed(true)
      setMessage("Enter an OpenAI API key beginning with sk-.")
      return
    }
    if (provider === "anthropic" && !secret.trim().startsWith("sk-ant-")) {
      setFailed(true)
      setMessage("Enter an Anthropic API key beginning with sk-ant-.")
      return
    }
    writing.current = true
    setBusy(true)
    setFailed(false)
    setMessage("")
    try {
      let sessionOnly = false
      if (provider === "openrouter" || provider === "nanogpt") {
        const result = await providerKey.mutateAsync({ provider, apiKey: secret.trim() })
        sessionOnly = result.sessionOnly === true
      } else if (provider === "cursor") {
        await cursorKey.mutateAsync({ key: "cursor.api_key", value: secret.trim() })
      } else {
        const result = await credential.mutateAsync({
          id: provider === "openai" ? "codex.api-key" : "claude.custom-api-token",
          secret: secret.trim(),
          metadata:
            provider === "custom"
              ? { baseUrl: baseUrl.trim(), model: model.trim() }
              : provider === "anthropic"
                ? { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" }
                : undefined,
        })
        sessionOnly = result.persistence === "session"
      }
      setSecret("")
      setMessage(sessionOnly ? "Saved for this session." : "Key saved.")
      onSaved()
    } catch {
      setFailed(true)
      setMessage("Could not confirm that the key was saved.")
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-3 pb-3 pl-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {provider === "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="setup-endpoint">Base URL</Label>
            <Input
              id="setup-endpoint"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-model">Model ID</Label>
            <Input
              id="setup-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              disabled={busy}
            />
          </div>
        </div>
      )}
      <Label htmlFor={provider + "-setup-key"}>API key</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-36 flex-1"
          id={provider + "-setup-key"}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          disabled={busy}
        />
        <Button type="submit" variant="outline" aria-disabled={!secret.trim() || busy}>
          {busy ? "Saving…" : "Save key"}
        </Button>
      </div>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {message}
        </p>
      )}
    </form>
  )
}

export function BillingMethodPage() {
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setLastAgent = useSetAtom(lastSelectedAgentIdAtom)
  const [queue, setQueue] = useState<NativeProvider[]>([])
  const [selected, setSelected] = useState<NativeProvider[]>([])
  const [justConnected, setJustConnected] = useState<NativeProvider[]>([])
  const flowHeading = useRef<HTMLHeadingElement>(null)
  const connectButton = useRef<HTMLButtonElement>(null)
  const [keyEditor, setKeyEditor] = useState<KeyProvider>()
  const claude = trpc.claudeCode.getIntegration.useQuery(undefined, { retry: false })
  const codex = trpc.codex.getIntegration.useQuery(undefined, { retry: false })
  const cursor = trpc.cursor.getIntegration.useQuery(undefined, { retry: false })
  const gemini = trpc.agentRuntimeChat.antigravityIntegration.useQuery(undefined, { retry: false })
  const keys = trpc.credentials.listStatuses.useQuery(undefined, { retry: false })
  const apiProviders = trpc.opencode.listProviders.useQuery(undefined, { retry: false })
  const usageKeys = trpc.usage.getSecretPresence.useQuery(undefined, { retry: false })
  const openExternal = trpc.external.openExternal.useMutation()
  const queries = [claude, codex, cursor, gemini, keys, apiProviders, usageKeys]
  const scanning = queries.some((query) => query.isFetching)
  const refresh = () => {
    for (const query of queries) void query.refetch()
  }

  function keySaved(provider: KeyProvider): boolean {
    if (provider === "openrouter" || provider === "nanogpt")
      return apiProviders.data?.some((item) => item.id === provider && item.configured) ?? false
    if (provider === "cursor") return Boolean(usageKeys.data?.["cursor.api_key"])
    if (provider === "openai")
      return keys.data?.some((item) => item.id === "codex.api-key" && item.configured) ?? false
    const credential = keys.data?.find((item) => item.id === "claude.custom-api-token")
    const url = credential?.metadata?.baseUrl?.replace(/\/$/, "")
    return (
      credential?.configured === true &&
      (provider === "custom"
        ? Boolean(url) && url !== "https://api.anthropic.com"
        : !url || url === "https://api.anthropic.com")
    )
  }

  const codexState = codex.data?.state
  const codexKey = keySaved("openai")
  const codexAuthLabel = codexState === "connected_api_key" ? "API key" : "Subscription"
  const codexConnected =
    codexState === "connected_chatgpt" || (codexState === "connected_api_key" && !codexKey)
  const states: Record<NativeProvider, ProviderState> = {
    "claude-code": providerState(
      claude.data?.isConnected ? "connected" : claude.data?.cliAuthState,
      claude.isError,
      keySaved("anthropic") || keySaved("custom"),
    ),
    codex: providerState(codexConnected ? "connected" : codexState, codex.isError, codexKey),
    antigravity: providerState(gemini.data?.state, gemini.isError),
    "cursor-agent": providerState(cursor.data?.state, cursor.isError, keySaved("cursor")),
  }
  for (const id of justConnected) states[id] = "connected"
  const active = queue[0]
  const availableSteps = nativeProviders
    .filter(
      ({ id }) => selected.includes(id) && (states[id] === "sign-in" || states[id] === "unknown"),
    )
    .map(({ id }) => id)
  const preferred =
    nativeProviders.find(({ id }) => states[id] === "connected")?.id ??
    nativeProviders.find(({ id }) => states[id] === "key-saved")?.id ??
    (keySaved("openrouter") ? "openrouter" : keySaved("nanogpt") ? "nanogpt" : undefined)

  useEffect(() => {
    if (active) flowHeading.current?.focus()
    else if (document.activeElement === document.body) connectButton.current?.focus()
  }, [active])

  function advance(id: NativeProvider, success: boolean) {
    if (success) {
      setJustConnected((previous) => [...previous, id])
      refresh()
    }
    setSelected((previous) => previous.filter((provider) => provider !== id))
    setQueue((previous) => (previous[0] === id ? previous.slice(1) : previous))
  }

  function finish(useLocalOnly = false) {
    setLastAgent(useLocalOnly ? "local" : (preferred ?? "local"))
    setBillingMethod(!useLocalOnly && preferred ? "configured-providers" : "local-only")
  }

  function toggleProvider(id: NativeProvider) {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }

  const nativeKeys: Partial<Record<NativeProvider, KeyProvider>> = {
    "claude-code": "anthropic",
    codex: "openai",
    "cursor-agent": "cursor",
  }
  function keyDisclosure(id: KeyProvider, label: string) {
    return (
      <button
        type="button"
        aria-expanded={keyEditor === id}
        onClick={() => setKeyEditor(keyEditor === id ? undefined : id)}
        className="flex min-h-8 items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
        <ChevronDown
          className={keyEditor === id ? "size-3.5 rotate-180" : "size-3.5"}
          aria-hidden="true"
        />
      </button>
    )
  }

  return (
    <div className="h-screen w-full overflow-y-auto bg-background">
      <div
        className="fixed inset-x-0 top-0 z-10 h-8 bg-background"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <main className="mx-auto w-full max-w-xl px-5 pb-10 pt-14 sm:px-8 sm:pt-20">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Connect AI providers</h1>
          <Button
            size="sm"
            variant="outline"
            aria-disabled={scanning}
            onClick={() => {
              if (scanning) return
              setJustConnected([])
              refresh()
            }}
          >
            <ScanLine className="mr-2 size-4" aria-hidden="true" />
            {scanning ? "Checking..." : "Detect all"}
          </Button>
        </header>

        <ul
          className="divide-y divide-border rounded-xl border border-border"
          aria-label="Providers"
        >
          {nativeProviders.map(({ id, name, icon }) => {
            const state = states[id]
            const install = installLinks[id]
            const keyProvider = nativeKeys[id]
            const needsSignIn = state === "sign-in" || state === "unknown"
            const authLabel =
              id === "codex" ? codexAuthLabel : id === "claude-code" ? "Subscription" : null
            return (
              <li key={id} className="px-3 sm:px-4">
                <div className="flex min-h-16 items-center gap-3 py-2">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                    aria-hidden="true"
                  >
                    {icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{name}</p>
                    <p
                      className={
                        state === "connected"
                          ? "text-xs text-emerald-700 dark:text-emerald-400"
                          : "text-xs text-muted-foreground"
                      }
                      role="status"
                    >
                      {authLabel && state !== "key-saved" && authLabel + " - "}
                      {stateLabels[state]}
                    </p>
                  </div>
                  {state === "connected" && (
                    <Check
                      aria-hidden="true"
                      className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                    />
                  )}
                  {install && state === "missing" && (
                    <Button size="sm" variant="ghost" onClick={() => openExternal.mutate(install)}>
                      Install <ExternalLink aria-hidden="true" className="ml-1 size-3" />
                    </Button>
                  )}
                  {needsSignIn && (
                    <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={"Sign in to " + name}
                        className="size-4 accent-primary"
                        checked={selected.includes(id)}
                        disabled={Boolean(active)}
                        onChange={() => toggleProvider(id)}
                      />
                      Sign in
                    </label>
                  )}
                </div>
                {keyProvider && (
                  <div className="pl-12 pb-1">
                    <div className="flex flex-wrap gap-x-3">
                      {keyDisclosure(
                        keyProvider,
                        keySaved(keyProvider) ? "API key saved" : "Use API key",
                      )}
                      {id === "claude-code" && keyDisclosure("custom", "Custom endpoint")}
                    </div>
                    {(keyEditor === keyProvider ||
                      (id === "claude-code" && keyEditor === "custom")) && (
                      <ProviderKeyForm key={keyEditor} provider={keyEditor} onSaved={refresh} />
                    )}
                  </div>
                )}
                {active === id && (
                  <section
                    className="mb-3 space-y-3 rounded-lg bg-muted/35 p-3"
                    aria-labelledby="active-sign-in"
                  >
                    <h2
                      ref={flowHeading}
                      id="active-sign-in"
                      tabIndex={-1}
                      className="text-sm font-semibold"
                    >
                      Sign in to {name}
                    </h2>
                    {id === "claude-code" && (
                      <ClaudeLocalAuthPanel autoStart onSuccess={() => advance(id, true)} />
                    )}
                    {id === "codex" && <CodexSignIn onConnected={() => advance(id, true)} />}
                    {id === "antigravity" && (
                      <AntigravitySignIn onConnected={() => advance(id, true)} />
                    )}
                    {id === "cursor-agent" && (
                      <CursorSignIn onConnected={() => advance(id, true)} />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setQueue([])}>
                        Back
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => advance(id, false)}>
                        Skip
                      </Button>
                    </div>
                  </section>
                )}
              </li>
            )
          })}
          {(["openrouter", "nanogpt"] as const).map((id) => (
            <li key={id} className="px-3 sm:px-4">
              <div className="flex min-h-16 items-center gap-3 py-2">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                  aria-hidden="true"
                >
                  <KeyRound className="size-4" />
                </span>
                <p className="flex-1 text-sm font-medium">
                  {id === "openrouter" ? "OpenRouter" : "NanoGPT"}
                </p>
                {keyDisclosure(id, keySaved(id) ? "API key saved" : "Add API key")}
              </div>
              {keyEditor === id && <ProviderKeyForm key={id} provider={id} onSaved={refresh} />}
            </li>
          ))}
        </ul>

        {queries.some((query) => query.isError) && (
          <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground" role="status">
            <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Some connection
            checks did not finish.
          </p>
        )}
        {!active && (
          <div className="mt-5 flex flex-wrap gap-2">
            {availableSteps.length > 0 && (
              <Button ref={connectButton} onClick={() => setQueue(availableSteps)}>
                Sign in to selected providers
              </Button>
            )}
            {preferred && (
              <Button
                ref={availableSteps.length ? undefined : connectButton}
                variant={availableSteps.length ? "outline" : "default"}
                onClick={() => finish()}
              >
                {preferred && nativeProviders.some(({ id }) => states[id] === "connected")
                  ? "Connect all detected"
                  : "Continue with saved keys"}
              </Button>
            )}
            <Button
              ref={preferred || availableSteps.length ? undefined : connectButton}
              variant={preferred || availableSteps.length ? "ghost" : "outline"}
              onClick={() => finish(true)}
            >
              Continue without a cloud provider
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
