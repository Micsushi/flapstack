import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const tourSource = readFileSync(
  resolve("src/renderer/features/onboarding/product-tour.tsx"),
  "utf8",
)
const layoutSource = readFileSync(resolve("src/renderer/features/layout/agents-layout.tsx"), "utf8")
const preferencesSource = readFileSync(
  resolve("src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx"),
  "utf8",
)

describe("main-page product tour", () => {
  it("mounts a concise accessible tour in the shared shell", () => {
    expect(layoutSource).toContain("<ProductTour />")
    expect(tourSource).toContain("const PRODUCT_TOUR_STEPS")
    expect(tourSource.match(/selector: /g)?.length).toBeLessThanOrEqual(8)
    expect(tourSource).toContain('role="dialog"')
    expect(tourSource).toContain('event.key === "Escape"')
    expect(tourSource).toContain("scrollIntoView")
  })

  it("can be rerun from Preferences", () => {
    expect(preferencesSource).toContain("Run tutorial")
    expect(preferencesSource).toContain("startProductTour()")
    expect(preferencesSource).toContain('data-settings-id="preferences-product-tour"')
  })
})
