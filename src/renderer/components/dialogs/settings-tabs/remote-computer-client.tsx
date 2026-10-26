import { useEffect, useRef, useState } from "react"
import {
  mobilePairingOfferSchema,
  type MobileSnapshotItem,
} from "../../../../shared/mobile-control"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { parseMobileConnectionLink } from "../../../../shared/mobile-connection-link"

type Clarification = Extract<MobileSnapshotItem, { kind: "agent-input" }>
export function RemoteComputerClientSection() {
  const utils = trpc.useUtils()
  const status = trpc.mobileClient.status.useQuery(undefined, {
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
  })
  const [offerText, setOfferText] = useState("")
  const [label, setLabel] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [grant, setGrant] = useState("")
  const [error, setError] = useState("")
  const [operation, setOperation] = useState<"pair" | "connect" | "disconnect" | null>(null)
  const [now, setNow] = useState(Date.now)
  const operationPending = useRef(false)
  const refreshed = () => {
    operationPending.current = false
    void utils.mobileClient.status.invalidate()
    setError("")
  }
  const failed = (error: { message: string }) => {
    operationPending.current = false
    setError(error.message)
  }
  const pair = trpc.mobileClient.pair.useMutation({
    onSuccess: () => {
      refreshed()
      setOfferText("")
      setGrant("")
      setConfirmed(false)
    },
    onError: failed,
  })
  const connect = trpc.mobileClient.connect.useMutation({ onSuccess: refreshed, onError: failed })
  const disconnect = trpc.mobileClient.disconnect.useMutation({
    onSuccess: refreshed,
    onError: failed,
  })
  let offer: ReturnType<typeof mobilePairingOfferSchema.parse> | null = null
  try {
    offer = parseMobileConnectionLink(offerText)
  } catch {
    /* Incomplete pasted offer. */
  }
  const expiresAt = offer?.expiresAt
  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  const expired = !!offer && offer.expiresAt <= now
  const state = status.data
  const busy = pair.isPending || connect.isPending || disconnect.isPending || state?.busy
  const statusUnavailable = status.isLoading || Boolean(status.error)
  return (
    <section className="space-y-4 border-t pt-5" aria-labelledby="remote-computer-heading">
      <div>
        <h2 id="remote-computer-heading" className="text-sm font-semibold">
          Remote computer
        </h2>
      </div>
      <label className="block space-y-1 text-sm">
        Computer label
        <input
          className="w-full rounded border bg-background px-3 py-2"
          disabled={busy}
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Office computer"
        />
      </label>
      <label className="block space-y-1 text-sm">
        Connection link
        <textarea
          className="w-full rounded border bg-background px-3 py-2 font-mono text-xs"
          rows={3}
          disabled={busy}
          value={offerText}
          onChange={(event) => {
            setOfferText(event.target.value)
            setConfirmed(false)
          }}
          placeholder="Paste the connection link copied from the host"
        />
      </label>
      {offer && (
        <div className="space-y-2 text-xs">
          <p className="break-all">Host: {offer.endpoint}</p>
          <p className="break-all">Certificate: {offer.certificateFingerprint}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              disabled={busy || expired}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I compared this address and fingerprint with the host computer.
          </label>
        </div>
      )}
      <Button
        disabled={!offer || expired || !confirmed || !label.trim() || busy || statusUnavailable}
        onClick={() => {
          if (!offer || offer.expiresAt <= Date.now() || operationPending.current) return
          operationPending.current = true
          setOperation("pair")
          setError("")
          pair.mutate({
            offer,
            label,
            confirmedEndpoint: new URL(offer.endpoint).origin,
            confirmedFingerprint: offer.certificateFingerprint,
          })
        }}
      >
        Pair computer
      </Button>
      {error && operation === "pair" && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {offerText.trim() && (!offer || expired) && (
        <p role="alert" className="text-sm text-destructive">
          {expired
            ? "This link expired. Copy a fresh connection link from the host."
            : "Paste a valid connection link copied from the host."}
        </p>
      )}
      {state?.host && (
        <div className="space-y-3">
          <p className="break-all text-sm">
            <strong>{state.host.label}</strong> · {state.host.endpoint}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            Device: {state.host.deviceId}. Give this device a grant on the host, then enter its
            grant ID below.
          </p>
          <label className="block space-y-1 text-sm">
            Host authority grant
            <input
              className="w-full rounded border bg-background px-3 py-2"
              disabled={busy}
              value={grant}
              onChange={(event) => setGrant(event.target.value)}
              maxLength={200}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!grant.trim() || busy || statusUnavailable}
              onClick={() => {
                if (operationPending.current) return
                operationPending.current = true
                setOperation("connect")
                setError("")
                connect.mutate({ grantId: grant.trim() })
              }}
            >
              Connect
            </Button>
            <Button
              variant="outline"
              disabled={busy || statusUnavailable}
              onClick={() => {
                if (operationPending.current) return
                operationPending.current = true
                setOperation("disconnect")
                setError("")
                disconnect.mutate()
              }}
            >
              Disconnect
            </Button>
          </div>
          {error && operation !== "pair" && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <p role="status" className="text-sm">
            {state.current && !status.error
              ? "Connected · current host state"
              : "Offline or stale · answers disabled"}
          </p>
          <p className="text-xs text-muted-foreground">
            {state.snapshot?.items.length ?? 0} scoped items. Host grant:{" "}
            {state.grantId || "not connected"}
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Scoped remote work">
            {state.snapshot?.items
              .filter((item) => item.kind !== "agent-input")
              .map((item) => (
                <li key={`${item.kind}:${item.id}`} className="break-all">
                  {item.kind}: {"name" in item ? item.name : "label" in item ? item.label : item.id}{" "}
                  · {item.id}
                  {"status" in item ? ` · ${item.status}` : ""}
                </li>
              ))}
          </ul>
          {state.snapshot?.items
            .filter((item): item is Clarification => item.kind === "agent-input")
            .map((item) => (
              <RemoteClarification
                key={`${state.connectionId}:${item.id}:${item.version}`}
                item={item}
                connectionId={state.connectionId}
                scopeVersion={state.snapshot!.scopeVersion}
                host={state.host!.endpoint}
                enabled={state.current && !status.error && !state.pending && !busy}
                receipt={state.receipt?.targetId === item.id ? state.receipt : null}
              />
            ))}
          {state.pending && (
            <p role="status" className="text-sm">
              Waiting for host receipt · {state.pending.commandId}
            </p>
          )}
          {state.receipt && (
            <p role="status" className="break-all text-sm">
              Host receipt: {state.receipt.status} · {state.receipt.host} · {state.receipt.targetId}{" "}
              · {state.receipt.commandId}
              {state.receipt.summary ? ` · ${state.receipt.summary}` : ""}
            </p>
          )}
        </div>
      )}
      {status.error && (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            Remote computer status unavailable: {status.error.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Retry status
          </Button>
        </div>
      )}
      {!error && state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </section>
  )
}

function RemoteClarification({
  item,
  connectionId,
  scopeVersion,
  host,
  enabled,
  receipt,
}: {
  item: Clarification
  connectionId: string
  scopeVersion: number
  host: string
  enabled: boolean
  receipt: { status: string; summary?: string } | null
}) {
  const utils = trpc.useUtils()
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const submitted = useRef(false)
  const [sent, setSent] = useState(false)
  const answer = trpc.mobileClient.answer.useMutation({
    onSuccess: () => {
      setSent(true)
      setConfirmed(false)
      void utils.mobileClient.status.invalidate()
    },
    onError: () => {
      submitted.current = false
    },
  })
  useEffect(() => {
    if (!answer.isPending && !sent) submitted.current = false
  })
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!enabled || !confirmed || answer.isPending || submitted.current) return
        const merged = Object.fromEntries(
          item.questions.map((question) => [
            question.id,
            [
              ...(answers[question.id] ?? []),
              ...(custom[question.id]?.trim() ? [custom[question.id].trim()] : []),
            ],
          ]),
        )
        submitted.current = true
        answer.mutate({
          connectionId,
          scopeVersion,
          targetId: item.id,
          targetVersion: item.version,
          answers: merged,
          confirmed: true,
        })
      }}
    >
      <p className="break-all text-xs">
        {host} · Chat {item.chatId} · Run {item.runId} · Request {item.id}
      </p>
      {item.questions.map((question) => (
        <fieldset
          key={question.id}
          disabled={!enabled || answer.isPending || sent}
          className="space-y-2"
        >
          <legend className="text-sm font-medium">{question.question}</legend>
          {question.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type={question.multiSelect ? "checkbox" : "radio"}
                name={`${item.id}:${question.id}`}
                checked={(answers[question.id] ?? []).includes(option)}
                onChange={(event) => {
                  setConfirmed(false)
                  if (!question.multiSelect)
                    setCustom((previous) => ({ ...previous, [question.id]: "" }))
                  setAnswers((previous) => ({
                    ...previous,
                    [question.id]: question.multiSelect
                      ? event.target.checked
                        ? [...(previous[question.id] ?? []), option]
                        : (previous[question.id] ?? []).filter((value) => value !== option)
                      : [option],
                  }))
                }}
              />
              {option}
            </label>
          ))}
          {question.allowCustom && (
            <label className="block text-sm">
              Your answer
              <input
                className="w-full rounded border bg-background px-3 py-2"
                maxLength={4000}
                value={custom[question.id] ?? ""}
                onChange={(event) => {
                  setConfirmed(false)
                  if (!question.multiSelect)
                    setAnswers((previous) => ({ ...previous, [question.id]: [] }))
                  setCustom((previous) => ({ ...previous, [question.id]: event.target.value }))
                }}
              />
            </label>
          )}
        </fieldset>
      ))}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          disabled={!enabled || answer.isPending || sent}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        Send these answers to this exact host, chat and request.
      </label>
      <Button type="submit" disabled={!enabled || !confirmed || answer.isPending || sent}>
        Send answer
      </Button>
      {sent && (
        <p role="status" className="text-sm">
          {receipt
            ? `Host receipt: ${receipt.status}. ${receipt.summary || "Check the host before submitting another answer."}`
            : "Answer submitted. Waiting for the host receipt; do not send it again."}
        </p>
      )}
      {answer.error && (
        <p role="alert" className="text-sm text-destructive">
          {answer.error.message}
        </p>
      )}
    </form>
  )
}
