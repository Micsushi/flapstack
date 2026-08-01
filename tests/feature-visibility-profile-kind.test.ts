import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveFeatureVisibilityProfileKind } from "../src/shared/feature-visibility"

describe("feature visibility profile migration", () => {
  it("preserves current visibility for an existing local-only project", () => {
    expect(
      resolveFeatureVisibilityProfileKind({
        hasExistingProject: true,
        hasLegacyProviderSetup: false,
      }),
    ).toBe("existing")
  })

  it("runs first-install onboarding only when no legacy product state exists", () => {
    expect(
      resolveFeatureVisibilityProfileKind({
        hasExistingProject: false,
        hasLegacyProviderSetup: false,
      }),
    ).toBe("fresh")
    expect(
      resolveFeatureVisibilityProfileKind({
        hasExistingProject: false,
        hasLegacyProviderSetup: true,
      }),
    ).toBe("existing")
  })

  it("feeds persisted projects into the existing-user decision", () => {
    const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8")
    expect(app).toContain(
      "hasExistingProject: Boolean(selectedProject || projects?.length || archivedProjects?.length)",
    )
    expect(app).toContain("trpc.projects.listArchived.useQuery()")
  })

  it("captures legacy provider evidence before fresh provider onboarding mutates live state", () => {
    const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8")

    expect(app).toContain("const [hadPersistedProviderSetup] = useState(hasProviderSetup)")
    expect(app).toMatch(
      /const hasLegacyProviderSetup\s*=\s*hadPersistedProviderSetup\s*\|\|\s*Boolean\(cliConfig\?\.hasConfig\)/,
    )
    expect(app).toContain("hadPersistedProviderSetup || !isLoadingCliConfig")
    expect(app).toContain("hasLegacyProviderSetup,")
    expect(app).toMatch(/selectedProject\s*\|\|\s*hasLegacyProviderSetup\s*\|\|/)
  })

  it("refreshes the onboarding gate when another workbench window applies visibility", () => {
    const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8")

    expect(app).toContain("onFeatureVisibilityChanged")
    expect(app).toContain("trpcUtils.featureVisibility.get.invalidate()")
  })
})
