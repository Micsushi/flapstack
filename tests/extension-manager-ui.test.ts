import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  createExtensionManagerState,
  exactPolicyDiff,
  extensionManagerReducer,
  filterExtensionManagerRows,
  nextExtensionSelection,
  type ExtensionManagerRow,
} from "../src/renderer/features/settings/extension-manager-state"

const rows: ExtensionManagerRow[] = [
  {
    id: "claude-skill",
    harness: "claude-code",
    kind: "skill",
    source: "native",
    scope: "user",
    name: "Réad Release",
    description: "Checks release evidence",
    path: "/home/.claude/skills/read-release/SKILL.md",
    support: "supported",
    runtime: "supported",
  },
  {
    id: "opencode-plugin",
    harness: "opencode",
    kind: "plugin",
    source: "plugin",
    scope: "plugin",
    name: "Audit",
    description: "Inventory only",
    path: "/home/.config/opencode/plugins/audit.ts",
    support: "unsupported",
    runtime: "not-consumed",
  },
  {
    id: "codex-hook",
    harness: "codex",
    kind: "hook",
    source: "managed",
    scope: "project",
    name: "After test",
    description: "PostToolUse disabled",
    path: "/repo · managed hook registry",
    support: "disabled",
    runtime: "disabled",
  },
]

describe("unified extension manager selectors", () => {
  it("filters independently by harness, kind, source, scope, and normalized search", () => {
    expect(
      filterExtensionManagerRows(rows, {
        harness: "claude-code",
        kind: "skill",
        source: "native",
        scope: "user",
        query: "read evidence",
      }).map((row) => row.id),
    ).toEqual(["claude-skill"])
    expect(
      filterExtensionManagerRows(rows, {
        harness: "all",
        kind: "plugin",
        source: "plugin",
        scope: "plugin",
        query: "not consumed",
      }).map((row) => row.id),
    ).toEqual(["opencode-plugin"])
  })

  it("keeps unsupported inventory searchable instead of hiding it", () => {
    expect(
      filterExtensionManagerRows(rows, {
        harness: "all",
        kind: "all",
        source: "all",
        scope: "all",
        query: "unsupported",
      }).map((row) => row.id),
    ).toEqual(["opencode-plugin"])
  })
})

describe("unified extension manager reducer", () => {
  it("clears stale action confirmation when filters or selection change", () => {
    let state = createExtensionManagerState("skill")
    state = extensionManagerReducer(state, { type: "select", id: "claude-skill" })
    state = extensionManagerReducer(state, { type: "begin", flow: "edit" })
    state = extensionManagerReducer(state, { type: "confirm-preview", confirmed: true })
    state = extensionManagerReducer(state, { type: "filter", key: "scope", value: "project" })
    expect(state).toMatchObject({ selectedId: null, flow: null, previewConfirmed: false })
  })

  it("reconciles selection and wraps keyboard navigation", () => {
    let state = extensionManagerReducer(createExtensionManagerState(), {
      type: "reconcile",
      visibleIds: ["a", "b", "c"],
    })
    expect(state.selectedId).toBe("a")
    expect(nextExtensionSelection(["a", "b", "c"], "c", "ArrowDown")).toBe("a")
    expect(nextExtensionSelection(["a", "b", "c"], "a", "ArrowUp")).toBe("c")
    expect(nextExtensionSelection(["a", "b", "c"], "b", "Home")).toBe("a")
    expect(nextExtensionSelection(["a", "b", "c"], "b", "End")).toBe("c")
  })

  it("renders an exact before and after policy record diff", () => {
    expect(
      exactPolicyDiff({
        scope: "task",
        enabled: false,
        currentEnabled: true,
        currentSource: "project",
      }),
    ).toContain('"taskOverride":false')
  })
})

describe("unified extension manager accessibility contract", () => {
  const source = readFileSync(
    "src/renderer/components/dialogs/settings-tabs/agents-provider-extensions-tab.tsx",
    "utf8",
  )

  it("exposes labelled search, filters, inventory, live counts, and roving list selection", () => {
    expect(source).toContain('aria-label="Search extensions"')
    expect(source).toContain('role="listbox"')
    expect(source).toContain('role="option"')
    expect(source).toContain("aria-selected={state.selectedId === item.id}")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("nextExtensionSelection")
    expect(source).toContain('event.key !== "/"')
  })

  it("requires review of identity, path, support, and diff before every apply", () => {
    expect(source).toContain("Exact target path")
    expect(source).toContain("Exact resulting diff")
    expect(source).toContain(
      "I reviewed the exact harness, scope, path, support state, and resulting diff.",
    )
    expect(source).toContain("!applicable || !confirmed || pending")
  })

  it("uses registry, policy, copy, native adapter, and managed hook APIs", () => {
    for (const contract of [
      "getCapabilities.useQuery",
      "getResolvedState.useQuery",
      "previewNativeMutation.query",
      "applyNativeMutation.useMutation",
      "previewCrossHarnessCopy.query",
      "setEnablementPolicy.useMutation",
      "hooksManagement.listInventory.useQuery",
      "hooksManagement.previewCommand.query",
    ]) {
      expect(source).toContain(contract)
    }
  })
})
