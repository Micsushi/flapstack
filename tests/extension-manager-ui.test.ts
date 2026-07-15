import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  createExtensionManagerState,
  exactPolicyDiff,
  extensionManagerInventoryStatus,
  extensionManagerPolicyMutationCwd,
  extensionManagerReducer,
  filterExtensionManagerRows,
  nextExtensionSelection,
  reverseUnifiedDiff,
  verifiedExtensionManagerProject,
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

  it("keeps stale-project user policy usable while project and task context fail closed", () => {
    const staleProject = { id: "project-stale", path: "/removed/project" }
    const verifiedProject = verifiedExtensionManagerProject(staleProject, false)

    expect(verifiedProject).toBeNull()
    expect(extensionManagerPolicyMutationCwd("user", verifiedProject?.path)).toBeUndefined()
    expect(extensionManagerPolicyMutationCwd("project", verifiedProject?.path)).toBeUndefined()
    expect(extensionManagerPolicyMutationCwd("task", verifiedProject?.path)).toBeUndefined()

    const currentProject = verifiedExtensionManagerProject(staleProject, true)
    expect(extensionManagerPolicyMutationCwd("user", currentProject?.path)).toBe(staleProject.path)
    expect(extensionManagerPolicyMutationCwd("project", currentProject?.path)).toBe(
      staleProject.path,
    )
    expect(extensionManagerPolicyMutationCwd("task", currentProject?.path)).toBe(staleProject.path)
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

  it("distinguishes loading, error, stale-error, refreshing, empty, and ready inventory", () => {
    expect(
      extensionManagerInventoryStatus({ count: 0, loading: true, fetching: true, hasError: false }),
    ).toBe("loading")
    expect(
      extensionManagerInventoryStatus({
        count: 0,
        loading: false,
        fetching: false,
        hasError: true,
      }),
    ).toBe("error")
    expect(
      extensionManagerInventoryStatus({
        count: 2,
        loading: false,
        fetching: false,
        hasError: true,
      }),
    ).toBe("stale-error")
    expect(
      extensionManagerInventoryStatus({
        count: 2,
        loading: false,
        fetching: true,
        hasError: false,
      }),
    ).toBe("refreshing")
    expect(
      extensionManagerInventoryStatus({
        count: 0,
        loading: false,
        fetching: false,
        hasError: false,
      }),
    ).toBe("empty")
    expect(
      extensionManagerInventoryStatus({
        count: 2,
        loading: false,
        fetching: false,
        hasError: false,
      }),
    ).toBe("ready")
  })

  it("builds the exact reverse diff used by the restore preview", () => {
    const reversed = reverseUnifiedDiff(
      "--- before.md\n+++ after.md\n@@ -1,2 +1,3 @@\n context\n-old\n+new\n+added\n",
    )
    expect(reversed.split("\n").slice(0, 3)).toEqual([
      "--- after.md",
      "+++ before.md",
      "@@ -1,3 +1,2 @@",
    ])
    expect(reversed).toBe(
      "--- after.md\n+++ before.md\n@@ -1,3 +1,2 @@\n context\n+old\n-new\n-added\n",
    )
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
    expect(source).toContain("headingRef.current?.focus()")
    expect(source).toContain("restoreInventoryFocus")
    expect(source).toContain('aria-label="Extension instructions"')
  })

  it("restores inventory focus after successful apply refresh completion or failure", () => {
    const confirmPreviewSource = source.slice(
      source.indexOf("const confirmPreview"),
      source.indexOf("const onListKeyDown"),
    )

    expect(confirmPreviewSource).toContain('toast.success("Extension change applied"')
    expect(confirmPreviewSource).toContain('toast.error("Extension inventory refresh failed"')
    expect(confirmPreviewSource).toMatch(
      /try \{\s+await refresh\(\)\s+\} catch \(error\) \{[\s\S]+\} finally \{\s+restoreInventoryFocus\(\)\s+\}/,
    )
  })

  it("requires review of identity, path, support, and diff before every apply", () => {
    expect(source).toContain("Exact target path")
    expect(source).toContain("Exact resulting diff")
    expect(source).toContain(
      "I reviewed the exact harness, scope, path, support state, and resulting diff.",
    )
    expect(source).toContain("!applicable || !confirmed || pending")
    expect(source).toContain("confirmationHash: preview.preview.confirmationHash")
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
      "hooksManagement.validateHook.useMutation",
      "hooksManagement.dryRunHook.useMutation",
      "hooksManagement.setEnabled.useMutation",
      "restoreNativeBackup.useMutation",
    ]) {
      expect(source).toContain(contract)
    }
  })

  it("renders honest provider badges, query states, policy precedence, and stale-safe restore", () => {
    expect(source).toContain("HarnessBadge")
    expect(source).toContain("Extension inventory could not be loaded")
    expect(source).toContain("Existing results may be stale")
    expect(source).toContain("Precedence: task override → project override → user default")
    expect(source).toContain("Preview restore")
    expect(source).toContain("This manager session can restore the latest backup")
    expect(source).toContain("Backup discovery is not persisted in the UI")
    expect(source).toContain("Restore is refused if provider-native content changed")
    expect(source).toContain("no approved native preview/apply/restore adapter")
    expect(source).toContain("verifiedExtensionManagerProject")
    expect(source).toContain("? (scopedResolvedState.data ?? [])")
    expect(source).toContain(": (userResolvedState.data ?? [])")
    expect(source).toContain("selectedProject ? scopedResolvedState : userResolvedState")
    expect(source).toContain(
      'policyScope === "user" || !selectedProject || Boolean(verifiedProject)',
    )
    expect(source).toContain(
      "cwd: extensionManagerPolicyMutationCwd(preview.location.type, verifiedProject?.path)",
    )
    expect(source).toContain("hasProject={Boolean(verifiedProject)}")
    expect(source).not.toContain("hasProject={Boolean(selectedProject)}")
  })

  it("exposes the full hook lifecycle with current-revision and approval gates", () => {
    expect(source).toContain('startsWith("hook-")')
    expect(source).toContain("flow: `hook-${action}`")
    expect(source).toContain('action === "dry-run"')
    expect(source).toContain('action === "enable"')
    expect(source).toMatch(
      /const validation =\s+action === "disable"\s+\? null\s+: await trpcClient\.hooksManagement\.previewCommand\.query/,
    )
    expect(source).toContain("id: selected.hook.id, path: selected.path")
    expect(source).toContain("Passed for current revision")
    expect(source).toContain("Tier 3 approval is required before enablement")
    expect(source).toContain('aria-label="Managed hook lifecycle actions"')
    expect(source).toContain("Native harness consumption remains")
  })
})
