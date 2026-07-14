import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Settings Usage layout", () => {
  it("uses the available settings width without cramping provider cards", () => {
    const settings = readSource("src/renderer/features/settings/settings-content.tsx")
    const usage = readSource("src/renderer/components/dialogs/settings-tabs/agents-usage-tab.tsx")

    expect(settings).toContain(
      'activeTab === "usage" ? "mx-auto w-full max-w-7xl" : "mx-auto max-w-2xl"',
    )
    expect(usage).toContain("grid grid-cols-1 gap-4 @[54rem]:grid-cols-2")
    expect(usage).toContain("@[38rem]:grid-cols-2")
    expect(usage).not.toContain("@[72rem]:grid-cols-2")
    expect(usage).not.toContain("xl:grid-cols-2")
    expect(usage).not.toContain("sm:grid-cols-2")
  })

  it("keeps loading, error, empty, limited, and paged states distinct", () => {
    const usage = readSource("src/renderer/components/dialogs/settings-tabs/agents-usage-tab.tsx")

    expect(usage).toContain("currentSamplesQuery.isLoading ?")
    expect(usage).toContain(": currentSamplesQuery.error ?")
    expect(usage).toContain(": currentSummaries.length === 0 ?")
    expect(usage).toContain('aria-label="Usage query errors"')
    expect(usage).toContain("Refresh completed with provider errors.")
    expect(usage).toContain("Limited history:")
    expect(usage).toContain("the latest provider-visible data can be recovered.")
    expect(usage).toContain("<PagingControls")
    expect(usage).toContain("Show all")
  })
})
