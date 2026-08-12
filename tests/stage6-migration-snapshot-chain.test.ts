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
  it("keeps post-Stage 6 snapshots linked to their exact schema additions", () => {
    const journal = readJson<Journal>("drizzle/meta/_journal.json")
    const snapshot50 = readJson<Snapshot>("drizzle/meta/0050_snapshot.json")
    const snapshot51 = readJson<Snapshot>("drizzle/meta/0051_snapshot.json")
    const snapshot52 = readJson<Snapshot>("drizzle/meta/0052_snapshot.json")
    const snapshot53 = readJson<Snapshot>("drizzle/meta/0053_snapshot.json")
    const snapshot54 = readJson<Snapshot>("drizzle/meta/0054_snapshot.json")
    const snapshot55 = readJson<Snapshot>("drizzle/meta/0055_snapshot.json")
    const snapshot56 = readJson<Snapshot>("drizzle/meta/0056_snapshot.json")
    const snapshot57 = readJson<Snapshot>("drizzle/meta/0057_snapshot.json")
    const snapshot58 = readJson<Snapshot>("drizzle/meta/0058_snapshot.json")

    expect(journal.entries.slice(-8).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 51, tag: "0051_runtime_composition_attempts" },
      { idx: 52, tag: "0052_project-vault-custom-notes" },
      { idx: 53, tag: "0053_chat-tags" },
      { idx: 54, tag: "0054_performance_indexes" },
      { idx: 55, tag: "0055_sidebar_query_indexes" },
      { idx: 56, tag: "0056_default_chat_tags" },
      { idx: 57, tag: "0057_chat_tag_icons" },
      { idx: 58, tag: "0058_agent_chat_metadata_and_waits" },
    ])
    expect(snapshot51.prevId).toBe(snapshot50.id)
    expect(snapshot52.prevId).toBe(snapshot51.id)
    expect(snapshot53.prevId).toBe(snapshot52.id)
    expect(snapshot54.prevId).toBe(snapshot53.id)
    expect(snapshot55.prevId).toBe(snapshot54.id)
    expect(snapshot56.prevId).toBe(snapshot55.id)
    expect(snapshot57.prevId).toBe(snapshot56.id)
    expect(snapshot58.prevId).toBe(snapshot57.id)
    expect(
      new Set([
        snapshot50.id,
        snapshot51.id,
        snapshot52.id,
        snapshot53.id,
        snapshot54.id,
        snapshot55.id,
        snapshot56.id,
        snapshot57.id,
        snapshot58.id,
      ]).size,
    ).toBe(9)

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
    expect(snapshot53.tables).toHaveProperty("chat_tags")
    expect(snapshot53.tables).toHaveProperty("chat_tag_assignments")
    expect(snapshot57.tables).not.toHaveProperty("chat_agent_labels")
    expect(snapshot58.tables).toHaveProperty("chat_agent_labels")
    expect(snapshot58.tables).toHaveProperty("chat_waits")
  })
})
