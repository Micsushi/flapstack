import { describe, expect, it } from "vitest"
import {
  normalizeSettingsSearchText,
  searchSettings,
} from "../src/renderer/features/settings/settings-search"

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

  it("routes Keyboard search through the released Settings registry", () => {
    const result = searchSettings("keyboard shortcuts", { showDevelopment: false })[0]
    expect(result).toMatchObject({ tab: "keyboard", targetId: "settings-tab-keyboard" })
  })
})
