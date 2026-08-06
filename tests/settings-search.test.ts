import { describe, expect, it } from "vitest"
import {
  SETTINGS_SEARCH_ENTRIES,
  normalizeSettingsSearchText,
  searchSettings,
} from "../src/renderer/features/settings/settings-search"
import {
  SETTINGS_CONTROL_REGISTRY,
  SETTINGS_PROVIDER_ORDER,
  compareSettingsProviders,
  getVisibleSettingsTabs,
} from "../src/renderer/features/settings/settings-visibility"
import { FEATURE_VISIBILITY_REGISTRY } from "../src/shared/feature-visibility"

describe("Settings search", () => {
  it("matches from the first typed character", () => {
    const results = searchSettings("p", { showDevelopment: false })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((result) => result.tab === "permissions")).toBe(true)
  })

  it("matches labels, descriptions, and curated permission keywords", () => {
    for (const query of ["permission", "access", "approval", "read only", "all chats"]) {
      expect(
        searchSettings(query, { showDevelopment: false }).some(
          (result) => result.tab === "permissions",
        ),
      ).toBe(true)
    }
  })

  it("ranks an exact label before weaker substring matches", () => {
    const results = searchSettings("default mode", { showDevelopment: false })
    expect(results[0]?.id).toBe("preferences-default-mode")
  })

  it("finds the Codex task visibility preference", () => {
    expect(searchSettings("codex task visibility", { showDevelopment: false })[0]).toMatchObject({
      tab: "preferences",
      targetId: "preferences-codex-task-visibility",
    })
  })

  it("requires every normalized query token to match", () => {
    expect(searchSettings("default permission", { showDevelopment: false })[0]?.id).toBe(
      "permissions-default",
    )
    expect(searchSettings("permission watermelon", { showDevelopment: false })).toEqual([])
  })

  it("normalizes case, accents, and punctuation", () => {
    expect(normalizeSettingsSearchText("  Réad-Only! ")).toBe("read only")
    expect(searchSettings("API-KEY", { showDevelopment: false })[0]?.tab).toBe("api-providers")
  })

  it("does not leak development-only settings", () => {
    expect(searchSettings("developer diagnostics", { showDevelopment: false })).toEqual([])
    expect(searchSettings("developer diagnostics", { showDevelopment: true })[0]?.tab).toBe("debug")
  })

  it("does not rediscover hidden or retired settings", () => {
    for (const query of [
      "legacy beta ollama",
      "future scaffolds roadmap",
      "quick switch ctrl tab agents",
      "model override",
    ]) {
      expect(searchSettings(query, { showDevelopment: true })).toEqual([])
    }
  })

  it("routes provider-scoped extension searches to promoted surfaces", () => {
    expect(searchSettings("codex skills", { showDevelopment: false })[0]?.tab).toBe("skills")
    expect(searchSettings("custom agents subagent", { showDevelopment: false })[0]?.tab).toBe(
      "agents",
    )
  })

  it("routes Keyboard search after its promotion gate passes", () => {
    expect(searchSettings("keyboard shortcuts", { showDevelopment: false })[0]).toMatchObject({
      tab: "keyboard",
      targetId: "settings-tab-keyboard",
    })
  })

  it("routes credential aliases to the exact write-only provider rows", () => {
    expect(searchSettings("openai whisper key", { showDevelopment: false })[0]).toMatchObject({
      tab: "api-providers",
      targetId: "credential-openai-voice-api-key",
    })
    expect(searchSettings("codex api key", { showDevelopment: false })[0]).toMatchObject({
      tab: "api-providers",
      targetId: "credential-codex-api-key",
    })
    expect(searchSettings("nanogpt credential", { showDevelopment: false })[0]).toMatchObject({
      tab: "api-providers",
      targetId: "nanogpt-provider-card",
    })
  })

  it("derives every control entry from the release registry with a stable target", () => {
    expect(new Set(SETTINGS_CONTROL_REGISTRY.map((entry) => entry.id)).size).toBe(
      SETTINGS_CONTROL_REGISTRY.length,
    )
    for (const control of SETTINGS_CONTROL_REGISTRY) {
      expect(SETTINGS_SEARCH_ENTRIES).toContainEqual(expect.objectContaining(control))
      expect(control.targetId).toBeTruthy()
    }
  })

  it("does not expose dynamic provider cards when that provider is unavailable", () => {
    expect(
      searchSettings("openrouter", { showDevelopment: false, availableProviders: [] }),
    ).toEqual([])
    expect(
      searchSettings("openrouter", {
        showDevelopment: false,
        availableProviders: ["openrouter"],
      })[0],
    ).toMatchObject({ id: "openrouter-provider-card", targetId: "openrouter-provider-card" })
  })

  it("keeps provider extension aliases scoped to supported inventories", () => {
    expect(searchSettings("cursor commands", { showDevelopment: false })[0]).toMatchObject({
      id: "skills-provider-extensions",
      providerScope: expect.arrayContaining(["cursor"]),
      targetId: "provider-extensions",
    })
    expect(searchSettings("opencode plugins", { showDevelopment: false })[0]).toMatchObject({
      id: "plugins-provider-extensions",
      providerScope: ["claude", "opencode"],
      targetId: "provider-extensions",
    })
  })

  it("sorts top-level categories by displayed English label", () => {
    for (const section of ["main", "advanced"] as const) {
      const labels = getVisibleSettingsTabs(section, { showDevelopment: true }).map(
        (entry) => entry.label,
      )
      expect(labels).toEqual(
        [...labels].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })),
      )
    }
  })

  it("keeps provider subgroups in one documented deterministic order", () => {
    expect([...SETTINGS_PROVIDER_ORDER].sort(compareSettingsProviders)).toEqual(
      SETTINGS_PROVIDER_ORDER,
    )
    expect(compareSettingsProviders("openrouter", "nanogpt")).toBeLessThan(0)
  })

  it("deep-links every optional feature to its exact visibility control", () => {
    for (const feature of FEATURE_VISIBILITY_REGISTRY) {
      const result = searchSettings(feature.label, { showDevelopment: false }).find(
        (entry) => entry.id === `feature-visibility-${feature.id}`,
      )
      expect(result).toMatchObject({
        tab: "feature-visibility",
        targetId: `feature-visibility-${feature.id}`,
      })
    }
  })
})
