import { useEffect, useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import { Logo } from "../../components/ui/logo"
import { Switch } from "../../components/ui/switch"
import {
  FEATURE_VISIBILITY_REGISTRY,
  type FeatureVisibilityPreset,
} from "../../../shared/feature-visibility"
import {
  createOnboardingVisibilitySession,
  parseOnboardingVisibilitySession,
  transitionOnboardingVisibility,
  type OnboardingVisibilityAction,
  type OnboardingVisibilitySession,
} from "../../../shared/onboarding-visibility"

const SESSION_KEY = "flapstack:onboarding-visibility:s6-v1"

export function FeatureVisibilityOnboardingPage(props: {
  revision: number
  visibility: Readonly<Record<string, boolean>>
  onApply: (input: {
    expectedRevision: number
    preset: FeatureVisibilityPreset
    visibility: Record<string, boolean>
  }) => Promise<void>
  onCancel?: () => void
}) {
  const [session, setSession] = useState(() => restoreSession(props.visibility, props.revision))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (session.step === "complete") return
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [session])

  useEffect(() => {
    if (session.step === "complete") return
    headingRef.current?.focus({ preventScroll: true })
  }, [session.step])

  const transition = (action: OnboardingVisibilityAction) => {
    setError(null)
    try {
      setSession((current) => transitionOnboardingVisibility(current, action))
    } catch (transitionError) {
      setError(messageFor(transitionError))
    }
  }

  const confirm = async () => {
    setError(null)
    const completed = transitionOnboardingVisibility(session, { type: "confirm" })
    if (!completed.apply) return
    setSaving(true)
    try {
      await props.onApply({
        expectedRevision: completed.baseRevision,
        preset: completed.apply.preset,
        visibility: completed.apply.visibility,
      })
      localStorage.removeItem(SESSION_KEY)
      setSession(completed)
    } catch (applyError) {
      setError(messageFor(applyError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="h-screen w-screen overflow-auto bg-background px-5 py-12 text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center">
        <section
          aria-labelledby="visibility-guide-title"
          className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9"
        >
          <header className="mb-8 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary">
              <Logo className="h-6 w-6" fill="white" />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Setup guide
              </p>
              <h1
                ref={headingRef}
                id="visibility-guide-title"
                tabIndex={-1}
                aria-live="polite"
                aria-atomic="true"
                className="text-xl font-semibold tracking-tight outline-none"
              >
                {titleForStep(session)}
              </h1>
            </div>
            {props.onCancel && (
              <Button className="ml-auto" variant="ghost" onClick={props.onCancel}>
                Cancel
              </Button>
            )}
          </header>

          {session.step === "welcome" && (
            <div className="space-y-6">
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Flapstack keeps projects, tasks, chats, permissions, run evidence, and recovery
                visible. This short guide only chooses which optional work surfaces appear first.
              </p>
              <Callout>
                Visibility never enables a provider, changes permission, starts background work, or
                deletes data.
              </Callout>
              <GuideActions onSkip={() => transition({ type: "skip" })}>
                <Button onClick={() => transition({ type: "continue" })}>Start guide</Button>
              </GuideActions>
            </div>
          )}

          {session.step === "hierarchy" && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <HierarchyCard
                  title="Project"
                  detail="The durable boundary for code and context."
                />
                <HierarchyCard title="Task" detail="A bounded outcome inside a project." />
                <HierarchyCard title="Chat" detail="One reviewable agent conversation and run." />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Optional surfaces such as orchestration, automations, mobile, and knowledge graph
                sit around that core. You can reveal any of them later in searchable Settings.
              </p>
              <GuideActions onSkip={() => transition({ type: "skip" })}>
                <Button onClick={() => transition({ type: "continue" })}>Choose my layout</Button>
              </GuideActions>
            </div>
          )}

          {session.step === "questionnaire" && (
            <div className="space-y-6">
              <Question
                legend="How do you usually collaborate?"
                name="collaboration"
                value={session.answers.collaboration}
                options={[
                  ["solo-pair", "Solo or one agent at a time"],
                  ["team-swarms", "Coordinated agent teams"],
                ]}
                onChange={(value) =>
                  transition({ type: "answer", question: "collaboration", value })
                }
              />
              <Question
                legend="Where does work begin?"
                name="workflow"
                value={session.answers.workflow}
                options={[
                  ["chat-first", "A focused chat"],
                  ["planning", "A plan or task board"],
                ]}
                onChange={(value) => transition({ type: "answer", question: "workflow", value })}
              />
              <Question
                legend="Where should work be reachable?"
                name="reach"
                value={session.answers.reach}
                options={[
                  ["desktop", "This desktop"],
                  ["cross-device", "Desktop and paired devices"],
                ]}
                onChange={(value) => transition({ type: "answer", question: "reach", value })}
              />
              <Question
                legend="How do you keep project knowledge?"
                name="knowledge"
                value={session.answers.knowledge}
                options={[
                  ["notes", "Simple notes"],
                  ["graph", "Linked notes and graph"],
                ]}
                onChange={(value) => transition({ type: "answer", question: "knowledge", value })}
              />
              <GuideActions onSkip={() => transition({ type: "skip" })}>
                <Button onClick={() => transition({ type: "review" })}>Review surfaces</Button>
              </GuideActions>
            </div>
          )}

          {session.step === "review" && session.preview && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Suggested preset:{" "}
                  <strong className="capitalize text-foreground">{session.preview.preset}</strong>.
                  Review every change before applying.
                </p>
                <span className="rounded-full border border-border px-3 py-1 text-xs font-medium">
                  {session.preview.changes.length} changes
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {FEATURE_VISIBILITY_REGISTRY.map((feature) => (
                  <div
                    key={feature.id}
                    className="flex items-start justify-between gap-4 rounded-xl border border-border p-4"
                  >
                    <div>
                      <p className="text-sm font-medium">{feature.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {feature.explanation.purpose}
                      </p>
                      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                        Why: {feature.explanation.why}
                      </p>
                      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                        Requires: {feature.explanation.prerequisites}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Authority: {feature.explanation.authority}
                      </p>
                    </div>
                    <Switch
                      aria-label={`Show ${feature.label}`}
                      checked={session.preview?.result[feature.id] ?? true}
                      onCheckedChange={(visible) =>
                        transition({ type: "customize", featureId: feature.id, visible })
                      }
                    />
                  </div>
                ))}
              </div>
              <Callout>
                Core safety and recovery surfaces remain visible. Hidden optional features keep
                their data and can be restored from Settings.
              </Callout>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end">
                <Button disabled={saving} onClick={() => void confirm()}>
                  {saving ? "Applying…" : "Apply and continue"}
                </Button>
              </div>
            </div>
          )}

          {session.step !== "review" && error && (
            <p role="alert" className="mt-5 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function restoreSession(
  visibility: Readonly<Record<string, boolean>>,
  revision: number,
): OnboardingVisibilitySession {
  const serialized = localStorage.getItem(SESSION_KEY)
  if (serialized) {
    try {
      const restored = parseOnboardingVisibilitySession(serialized)
      if (restored.step !== "complete" && restored.baseRevision === revision) return restored
    } catch {
      // Replace only the invalid resumable session. Durable visibility is untouched.
    }
  }
  return createOnboardingVisibilitySession(visibility, revision)
}

function titleForStep(session: OnboardingVisibilitySession): string {
  if (session.step === "welcome") return "Start with the right amount of Flapstack"
  if (session.step === "hierarchy") return "Projects contain tasks; tasks use chats"
  if (session.step === "questionnaire") return "Tell us how you work"
  return "Review your visible surfaces"
}

function GuideActions(props: { onSkip: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" onClick={props.onSkip}>
        Skip and review Standard
      </Button>
      {props.children}
    </div>
  )
}

function HierarchyCard(props: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">{props.title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.detail}</p>
    </div>
  )
}

function Callout(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6">
      {props.children}
    </div>
  )
}

function Question<T extends string>(props: {
  legend: string
  name: string
  value: T | undefined
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{props.legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {props.options.map(([value, label]) => (
          <label
            key={value}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name={props.name}
              value={value}
              checked={props.value === value}
              onChange={() => props.onChange(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "The visibility setup could not be saved."
}
