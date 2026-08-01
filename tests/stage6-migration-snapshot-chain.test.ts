import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

interface Snapshot {
  id: string
  prevId: string
  tables: Record<
    string,
    {
      indexes?: Record<string, { isUnique?: boolean; where?: string }>
    }
  >
}

interface Journal {
  entries: Array<{ idx: number; tag: string }>
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T
}

describe("stage 6 migration snapshots", () => {
  it("keeps the 0051 and 0052 snapshots linked to their exact schema additions", () => {
    const journal = readJson<Journal>("drizzle/meta/_journal.json")
    const snapshot50 = readJson<Snapshot>("drizzle/meta/0050_snapshot.json")
    const snapshot51 = readJson<Snapshot>("drizzle/meta/0051_snapshot.json")
    const snapshot52 = readJson<Snapshot>("drizzle/meta/0052_snapshot.json")

    expect(journal.entries.slice(-2).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 51, tag: "0051_runtime_composition_attempts" },
      { idx: 52, tag: "0052_project-vault-custom-notes" },
    ])
    expect(snapshot51.prevId).toBe(snapshot50.id)
    expect(snapshot52.prevId).toBe(snapshot51.id)
    expect(new Set([snapshot50.id, snapshot51.id, snapshot52.id]).size).toBe(3)

    expect(snapshot50.tables).not.toHaveProperty("runtime_composition_attempts")
    expect(snapshot51.tables).toHaveProperty("runtime_composition_attempts")
    expect(
      snapshot51.tables.runtime_composition_attempts.indexes
        ?.runtime_composition_attempts_active_worktree_idx,
    ).toMatchObject({
      isUnique: true,
      where:
        '"runtime_composition_attempts"."worktree_path" is not null and "runtime_composition_attempts"."status" = \'running\'',
    })

    expect(snapshot51.tables).not.toHaveProperty("project_vault_custom_notes")
    expect(snapshot52.tables).toHaveProperty("runtime_composition_attempts")
    expect(snapshot52.tables).toHaveProperty("project_vault_custom_notes")
  })
})
