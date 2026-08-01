import { describe, expect, it } from "vitest"
import {
  ALWAYS_VISIBLE_FEATURE_IDS,
  FEATURE_VISIBILITY_REGISTRY,
  applyVisibilityPreview,
  explainFeature,
  previewVisibilityPreset,
  resolveOnboardingPreset,
  validateFeatureVisibilityRegistry,
} from "../src/shared/feature-visibility"

describe("Stage 6 feature visibility authority", () => {
  it("keeps safety, recovery, Settings, and local workspace core always visible", () => {
    expect(ALWAYS_VISIBLE_FEATURE_IDS).toEqual(
      expect.arrayContaining([
        "projects",
        "tasks",
        "chats",
        "search",
        "settings",
        "permissions",
        "recovery",
        "run-evidence",
      ]),
    )
    expect(
      FEATURE_VISIBILITY_REGISTRY.some((entry) =>
        ALWAYS_VISIBLE_FEATURE_IDS.includes(entry.id as never),
      ),
    ).toBe(false)
  })

  it("registers every optional production surface once with reusable explanations", () => {
    expect(validateFeatureVisibilityRegistry(FEATURE_VISIBILITY_REGISTRY)).toEqual([])
    expect(FEATURE_VISIBILITY_REGISTRY.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "plan",
        "saved-workspaces",
        "automations",
        "orchestration",
        "agent-profiles",
        "runtimes",
        "voice",
        "usage",
        "mobile-companion",
        "visual-context",
        "knowledge-graph",
      ]),
    )
    for (const entry of FEATURE_VISIBILITY_REGISTRY) {
      expect(entry.settingsTarget).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/)
      expect(entry.routes.length).toBeGreaterThan(0)
      expect(entry.searchKeywords.length).toBeGreaterThan(0)
      expect(entry.explanation.version).toMatch(/^s6-\d+$/)
      expect(entry.explanation.purpose).not.toHaveLength(0)
      expect(entry.explanation.why).not.toHaveLength(0)
      expect(entry.explanation.prerequisites).not.toHaveLength(0)
      expect(entry.explanation.risk).not.toHaveLength(0)
      expect(entry.explanation.authority).not.toHaveLength(0)
      expect(entry.explanation.reenable).toContain("Settings > Feature Visibility")
      expect(entry.explanation.enableRoute).toBe(entry.settingsTarget)
      expect(explainFeature(entry.id)).toBe(entry.explanation)
    }
  })

  it("maps bounded answer sets deterministically without hiding core", () => {
    expect(
      resolveOnboardingPreset({
        collaboration: "solo-pair",
        workflow: "chat-first",
        reach: "desktop",
        knowledge: "notes",
      }),
    ).toBe("focused")
    expect(
      resolveOnboardingPreset({
        collaboration: "team-swarms",
        workflow: "planning",
        reach: "cross-device",
        knowledge: "graph",
      }),
    ).toBe("complete")
    expect(
      resolveOnboardingPreset({
        collaboration: "solo-pair",
        workflow: "planning",
        reach: "desktop",
        knowledge: "notes",
      }),
    ).toBe("standard")
  })

  it("previews an exact reversible diff and mutates only after explicit apply", () => {
    const current = Object.fromEntries(FEATURE_VISIBILITY_REGISTRY.map((entry) => [entry.id, true]))
    const preview = previewVisibilityPreset(current, "focused")

    expect(current.plan).toBe(true)
    expect(preview.preset).toBe("focused")
    expect(preview.changes.length).toBeGreaterThan(0)
    expect(preview.changes.every((change) => change.before !== change.after)).toBe(true)
    expect(applyVisibilityPreview(current, preview)).toEqual(preview.result)
    expect(current).not.toEqual(preview.result)
  })

  it("preserves existing-user visibility and defaults unknown future features visibly", () => {
    const existing = { plan: false, "saved-workspaces": true, futureFeature: true }
    const preview = previewVisibilityPreset(existing, "standard", {
      preserveUnknown: true,
      existingUser: true,
    })

    expect(preview.result.futureFeature).toBe(true)
    expect(existing).toEqual({
      plan: false,
      "saved-workspaces": true,
      futureFeature: true,
    })
  })
})
