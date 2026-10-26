import { useRef, useState, type FormEvent } from "react"
import type { UsageProviderPreferences } from "../../../../main/lib/usage/settings"
import type { UsageProviderId } from "../../../../main/lib/usage/types"
import { recordAppAction } from "../../../lib/app-action-history"
import { trpc, trpcClient } from "../../../lib/trpc"

type Fields = Record<"cadence" | "quota" | "spend" | "rate" | "spike", string>
type Draft = { base: UsageProviderPreferences; fields: Fields }

function fieldsFor(value: UsageProviderPreferences): Fields {
  return {
    cadence: String(value.cadenceSecondsOverride ?? ""),
    quota: value.thresholds.quotaPercent.join(", "),
    spend: value.thresholds.spendUsd.join(", "),
    rate: String(value.thresholds.spendRateUsdPerHour ?? ""),
    spike: String(value.thresholds.spikeMultiplier ?? ""),
  }
}

function thresholds(value: string, label: string, maximum = Infinity): number[] {
  if (!value.trim()) return []
  const parts = value.split(",").map((part) => part.trim())
  const numbers = parts.map(Number)
  if (
    parts.some((part) => !part) ||
    numbers.some((n) => !Number.isFinite(n) || n < 0 || n > maximum)
  ) {
    throw new Error(
      `${label}: enter comma-separated numbers${maximum === 100 ? " from 0 to 100" : " of zero or more"}, or leave blank to disable.`,
    )
  }
  return [...new Set(numbers)]
}

function optionalNumber(value: string, label: string, minimum: number): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number < minimum) {
    throw new Error(
      `${label}: enter ${minimum ? `at least ${minimum}` : "a number greater than zero"}, or leave blank.`,
    )
  }
  return number
}

export function UsageProviderSettingsForm({
  providerId,
  saved,
}: {
  providerId: UsageProviderId
  saved: UsageProviderPreferences
}) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState(false)
  const fields = draft?.fields ?? fieldsFor(saved)
  const refresh = (
    result: Awaited<ReturnType<typeof trpcClient.usage.setProviderSettings.mutate>>,
  ) => {
    utils.usage.getSettings.setData(undefined, result)
    void utils.usage.getSettings.invalidate().catch(() => {})
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy.current) return
    const submitted = draft
    let next: UsageProviderPreferences
    setError(null)
    setSavedMessage(false)
    try {
      next = {
        cadenceSecondsOverride: optionalNumber(fields.cadence, "Poll seconds", 30),
        thresholds: {
          quotaPercent: thresholds(fields.quota, "Quota alerts", 100),
          spendUsd: thresholds(fields.spend, "Spend alerts"),
          spendRateUsdPerHour: optionalNumber(fields.rate, "Spend rate", 0),
          spikeMultiplier: optionalNumber(fields.spike, "Spend spike multiplier", 0),
        },
      }
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    busy.current = true
    setPending(true)
    try {
      const { cadenceSecondsOverride, thresholds } = submitted.base
      const before = { cadenceSecondsOverride, thresholds }
      const result = await trpcClient.usage.setProviderSettings.mutate({
        providerId,
        ...next,
        expected: before,
      })
      const apply = async (value: UsageProviderPreferences, expected: UsageProviderPreferences) => {
        refresh(
          await trpcClient.usage.setProviderSettings.mutate({ providerId, ...value, expected }),
        )
      }
      recordAppAction({
        label: `Change ${providerId} usage alerts and cadence`,
        undo: () => apply(before, next),
        redo: () => apply(next, before),
      })
      refresh(result)
      setDraft((current) =>
        current === submitted ? null : current ? { ...current, base: next } : null,
      )
      setSavedMessage(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings could not be saved. Try again.")
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 space-y-2"
      aria-label={`${providerId} alert settings`}
      aria-busy={pending}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {(
          [
            ["cadence", "Poll seconds (blank = global)"],
            ["quota", "Quota alerts %"],
            ["spend", "Spend alerts USD"],
            ["rate", "Spend rate USD/hour"],
            ["spike", "Spend spike multiplier"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="min-w-0 text-xs text-muted-foreground">
            {label}
            <input
              value={fields[key]}
              inputMode="decimal"
              className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1"
              onChange={(event) => {
                const value = event.target.value
                setDraft((current) => ({
                  base: current?.base ?? saved,
                  fields: { ...(current?.fields ?? fieldsFor(saved)), [key]: value },
                }))
                setSavedMessage(false)
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Blank alert fields disable that alert. Changes apply after saving.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!draft || pending}
          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "Saving…" : error ? "Retry save" : "Save alerts and cadence"}
        </button>
        {draft && (
          <button
            type="button"
            disabled={pending}
            className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
            onClick={async () => {
              const discarded = draft
              if (busy.current) return
              busy.current = true
              setPending(true)
              try {
                await utils.usage.getSettings.fetch()
                setDraft((current) => (current === discarded ? null : current))
                setError(null)
                setSavedMessage(false)
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Saved settings could not load. Your draft is retained.",
                )
              } finally {
                busy.current = false
                setPending(false)
              }
            }}
          >
            Discard draft and reload
          </button>
        )}
        <span role="status" className="text-xs text-muted-foreground">
          {savedMessage
            ? draft
              ? "Saved. New edits are not saved."
              : "Saved."
            : draft
              ? "Unsaved changes"
              : ""}
        </span>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
