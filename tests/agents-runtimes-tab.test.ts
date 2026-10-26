import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  "src/renderer/components/dialogs/settings-tabs/agents-runtimes-tab.tsx",
  "utf8",
)

describe("agent runtimes settings recovery", () => {
  it("keeps defaults and capabilities failures visible and retryable", () => {
    expect(source).toContain("RuntimeQueryStatus")
    expect(source).toContain("placeholderData: (previous) => previous")
    expect(source).toContain('label="defaults"')
    expect(source).toContain('label="capabilities"')
    expect(source).toContain('label="project scope"')
    expect(source).toContain("onRetry={() => void refetchProjects()}")
    expect(source).toContain("onRetry={() => void refetchDefaults()}")
    expect(source).toContain("onRetry={() => void refetchReleases()}")
    expect(source).toContain("settingsUnavailable")
    expect(source).toContain(
      "disabled={settingsUnavailable || write.isPending || remove.isPending}",
    )
    expect(source).toContain("disabled={settingsUnavailable || remove.isPending}")
    expect(source).toContain("{defaultsData ? (")
    expect(source).toContain("{releasesData ? (")
  })
})
