import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("Stage 6 F1/F2 renderer contract", () => {
  it("reuses feature explanations in Settings, onboarding, an empty state, and contextual help", () => {
    const settings = source(
      "src/renderer/components/dialogs/settings-tabs/agents-feature-visibility-tab.tsx",
    )
    const onboarding = source(
      "src/renderer/features/onboarding/feature-visibility-onboarding-page.tsx",
    )
    const automations = source("src/renderer/features/automations/automations-view.tsx")
    const help = source("src/renderer/components/feature-explanation.tsx")

    expect(settings).toContain("feature.explanation.authority")
    expect(onboarding).toContain("feature.explanation.why")
    expect(automations).toContain('<FeatureExplanationSummary featureId="automations"')
    expect(automations).toContain('<FeatureHelpPopover featureId="automations"')
    expect(help).toContain("explainFeature(featureId)")
    expect(help).toContain("What is this?")
  })

  it("keeps dictation reviewable and threads selected context without auto-submit", () => {
    const dictation = source("src/renderer/features/agents/voice/dictation-session.tsx")
    const input = source("src/renderer/features/agents/main/chat-input-area.tsx")
    const router = source("src/main/lib/trpc/routers/voice.ts")

    expect(input).toContain("buildSelectedSpeechVocabulary(selectedSpeechContext)")
    expect(input).toContain("<SpeechVocabularyPopover")
    expect(dictation).toContain(
      "allowCloudSelectedContext: target.allowCloudSelectedContext ?? false",
    )
    expect(dictation).not.toContain("target.onSend")
    expect(router).toContain("resolveSpeechVocabularyHints(")
  })

  it("uses compact keyboard controls and reduced-motion-safe transcript jumps", () => {
    const overview = source("src/renderer/features/agents/main/chat-transcript-overview.tsx")
    const activeChat = source("src/renderer/features/agents/main/active-chat.tsx")
    const settingsTarget = source("src/renderer/features/settings/settings-target.ts")

    expect(overview).toContain("h-4 w-7")
    expect(overview).toContain("touch-manipulation")
    expect(overview).toContain("Private reasoning is never summarized here.")
    expect(activeChat).toContain("prefers-reduced-motion: reduce")
    expect(activeChat).toContain("target.focus({ preventScroll: true })")
    expect(settingsTarget).toContain('behavior: reduceMotion ? "auto" : "smooth"')
  })
})
