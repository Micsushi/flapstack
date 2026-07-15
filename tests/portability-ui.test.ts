import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  clampPortabilityPage,
  importApplyConfirmation,
  paginatePortabilityResults,
  parseTargetRootMappings,
  privateSyncConfirmation,
  unresolvedPortabilityConflicts,
} from "../src/renderer/features/settings/portability-ui-state"
import { searchSettings } from "../src/renderer/features/settings/settings-search"
import { getVisibleSettingsTabs } from "../src/renderer/features/settings/settings-visibility"

describe("portability-ui", () => {
  it("releases a searchable Portability & Sync settings route", () => {
    expect(getVisibleSettingsTabs("advanced").some((tab) => tab.id === "portability")).toBe(true)
    expect(
      searchSettings("backup", { showDevelopment: false }).some(
        (result) => result.tab === "portability",
      ),
    ).toBe(true)
    expect(
      searchSettings("private git sync", { showDevelopment: false }).some(
        (result) => result.tab === "portability",
      ),
    ).toBe(true)
  })

  it("paginates large results and blocks unresolved conflicts", () => {
    const values = Array.from({ length: 121 }, (_, index) => ({
      id: String(index),
      kind: index % 10 === 0 ? ("conflict" as const) : ("skip" as const),
    }))
    expect(paginatePortabilityResults(values, 0)).toHaveLength(50)
    expect(paginatePortabilityResults(values, 2)).toHaveLength(21)
    expect(clampPortabilityPage(4, values.length)).toBe(2)
    expect(clampPortabilityPage(2, 0)).toBe(0)
    expect(unresolvedPortabilityConflicts(values, { "0": "keep-local" })).toHaveLength(12)
  })

  it("names destructive scope and exact sync preview in confirmations", () => {
    expect(importApplyConfirmation({ create: 2, update: 1, conflict: 3 })).toBe(
      "Apply reviewed import? 2 creates, 1 updates, 3 conflicts, no implicit deletes. A pre-import backup will be created.",
    )
    expect(privateSyncConfirmation("push", "1234567890abcdef")).toContain("1234567890ab")
  })

  it("keeps keyboard-native controls and live status labels in the rendered source", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/components/dialogs/settings-tabs/agents-portability-tab.tsx",
        import.meta.url,
      ),
      "utf8",
    )
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('aria-label="Import dry-run results"')
    expect(source).toContain('aria-label="Private sync reviewed files"')
    expect(source).toContain('aria-label="Private sync preview pagination"')
    expect(source).toContain("<fieldset")
    expect(source).toContain("<legend")
    expect(source).toContain("Previous")
    expect(source).toContain("Next")
    expect(source).toContain("Previous sync files")
    expect(source).toContain("Next sync files")
    expect(source).toContain("clampPortabilityPage")
    expect(source).toContain("setSyncPage(0)")
    expect(source).toContain("Local value")
    expect(source).toContain("Incoming value")
    expect(source).toContain("Reviewed local OID")
    expect(source).toContain("Conflict artifacts")
    expect(source).toContain("invalidateImportPlan")
    expect(source).toContain("expectedConfirmationHash")
    expect(source).toContain("Reviewed live targets")
    expect(source).toContain("entry.targetPath")
  })

  it("parses explicit clean-profile root mappings", () => {
    expect(parseTargetRootMappings("p1=/tmp/project\np2=/tmp/other")).toEqual({
      p1: "/tmp/project",
      p2: "/tmp/other",
    })
    expect(() => parseTargetRootMappings("p1=relative")).toThrow(/absolute/i)
  })
})
