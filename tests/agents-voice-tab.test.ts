import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  "src/renderer/components/dialogs/settings-tabs/agents-voice-tab.tsx",
  "utf8",
)

describe("voice settings recovery", () => {
  it("distinguishes core and history failures from loading or empty state", () => {
    expect(source).toContain("VoiceQueryStatus")
    expect(source).toContain("placeholderData: (previous) => previous")
    expect(source).toContain("onRetry={() => void refetchSettings()}")
    expect(source).toContain("onRetry={() => void refetchAdapters()}")
    expect(source).toContain("onRetry={() => void refetchHistory()}")
    expect(source).toContain("historyError && !history ? null")
    expect(source).toContain("Loading {label}…")
  })
})
