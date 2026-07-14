import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  deleteUsageExplorerView,
  listUsageExplorerViews,
  saveUsageExplorerView,
} from "../src/main/lib/usage/explorer-views"
import {
  advancedUsageExplorerReducer,
  initialAdvancedUsageExplorerState,
  qualityCopy,
  splitUsageFilter,
} from "../src/renderer/features/usage/advanced-usage-model"

const directories: string[] = []
const originalConfigDir = process.env.FLAPSTACK_CONFIG_DIR

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
  else process.env.FLAPSTACK_CONFIG_DIR = originalConfigDir
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("advanced usage explorer state", () => {
  it("keeps all filter dimensions and resets drill-down when a query changes", () => {
    const initial = initialAdvancedUsageExplorerState(1_000_000, "America/Vancouver")
    const selected = advancedUsageExplorerReducer(initial, { type: "aggregate", key: "model:gpt" })
    const query = {
      ...initial.query,
      scope: { type: "project" as const, id: "project-1" },
      providerIds: ["openrouter"],
      accountTags: ["team"],
      harnesses: ["openrouter" as const],
      models: ["openai/gpt-5"],
      sources: ["flapstack-run"],
      sourceClasses: ["flapstack-run" as const],
      qualities: ["estimated" as const],
      fromMs: 100,
      toMs: 200,
    }
    const changed = advancedUsageExplorerReducer(selected, { type: "query", query })
    expect(changed.query).toMatchObject(query)
    expect(changed.selectedAggregateKey).toBe("totals")
    expect(splitUsageFilter(" codex, openrouter, codex ")).toEqual(["codex", "openrouter"])
  })

  it("never presents estimated or unknown quality as exact", () => {
    expect(qualityCopy("exact")).toMatchObject({ label: "Exact", approximate: false })
    expect(qualityCopy("estimated")).toMatchObject({ label: "Estimated", approximate: true })
    expect(qualityCopy("estimated").description).toContain("Approximate")
    expect(qualityCopy("unknown")).toMatchObject({ label: "Unknown quality", approximate: true })
    expect(qualityCopy("unknown").description).toContain("cannot support an exact")
  })
})

describe("durable advanced usage views", () => {
  it("creates, reloads, updates, and deletes validated named views", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-usage-views-"))
    directories.push(directory)
    process.env.FLAPSTACK_CONFIG_DIR = directory
    const input = {
      name: "Estimated project spend",
      query: {
        scope: { type: "project" as const, id: "project-1" },
        providerIds: ["openrouter"],
        qualities: ["estimated" as const],
        timezone: "UTC",
        bucket: "day" as const,
        groupBy: "model" as const,
        limit: 100,
        cursor: null,
      },
      metric: "cost-usd-micros" as const,
    }
    const created = saveUsageExplorerView(input, 100)
    expect(listUsageExplorerViews()).toEqual([created])
    const updated = saveUsageExplorerView({ ...input, id: created.id, name: "Renamed" }, 200)
    expect(updated).toMatchObject({
      id: created.id,
      name: "Renamed",
      createdAt: 100,
      updatedAt: 200,
    })
    expect(listUsageExplorerViews()).toEqual([updated])
    expect(deleteUsageExplorerView(created.id)).toEqual({ deleted: true })
    expect(listUsageExplorerViews()).toEqual([])
  })
})
