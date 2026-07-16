import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import { RuntimeSelector } from "../src/renderer/features/agents/runtime-settings/runtime-selector"
import {
  allowedRuntimePreferences,
  buildRuntimeSettingsRows,
} from "../src/renderer/features/agents/runtime-settings/runtime-settings-model"

describe("Agent Runtime settings presentation", () => {
  const releases = [
    { runtime: "codex" as const, enabledForNewLaunches: false, reason: "Package gate open." },
    {
      runtime: "claude-code" as const,
      enabledForNewLaunches: false,
      reason: "Provider gate open.",
    },
    { runtime: "flapstack-native" as const, enabledForNewLaunches: true, reason: null },
  ]

  it("shows one row per harness with inherited project state and exact unavailable reasons", () => {
    const rows = buildRuntimeSettingsRows({
      scope: { type: "project", id: "project-1" },
      releases,
      defaults: [
        {
          scope: { type: "global", id: null },
          harness: "codex",
          preference: "flapstack-native",
          version: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({
      harness: "codex",
      selected: "auto",
      inherited: "flapstack-native",
      version: 0,
    })
    expect(rows[0]?.options.find((option) => option.value === "codex")).toMatchObject({
      compatible: true,
      available: false,
      reason: "Package gate open.",
    })
    expect(rows.find((row) => row.harness === "openrouter")?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "codex", compatible: false }),
        expect.objectContaining({ value: "flapstack-native", available: true }),
      ]),
    )
  })

  it("renders a compact automatic-runtime trigger without a separate label", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeSelector, {
        harness: "claude-code",
        value: "auto",
        onChange: () => undefined,
      }),
    )
    expect(html).toContain('aria-label="Runtime"')
    expect(html).toContain("Automatic runtime")
    expect(html).not.toContain("<select")
    expect(html).not.toContain("<span>Runtime</span>")
    expect(allowedRuntimePreferences("claude-code")).toEqual([
      "auto",
      "claude-code",
      "flapstack-native",
    ])
  })
})
