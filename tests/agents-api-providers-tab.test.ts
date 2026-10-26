import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  "src/renderer/components/dialogs/settings-tabs/agents-api-providers-tab.tsx",
  "utf8",
)

describe("API provider settings recovery", () => {
  it("keeps provider and model catalog failures visible and retryable", () => {
    expect(source).toContain("ProviderQueryStatus")
    expect(source).toContain("placeholderData: (previous) => previous")
    expect(source).toContain('label="provider details"')
    expect(source).toContain("onRetry={() => void refetchProviders()}")
    expect(source).toContain('label="provider runtime"')
    expect(source).toContain("onRetry={() => void refetchRuntime()}")
    expect(source).toContain("modelCatalogError")
    expect(source).toContain("onRetry={() => void refetchModelCatalog()}")
    expect(source).toContain("!modelCatalogError")
    expect(source).toContain('source ?? (modelCatalogLoading ? "loading" : "unavailable")')
  })
})
