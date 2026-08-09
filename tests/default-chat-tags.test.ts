import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function read(path: string): string {
  return readFileSync(resolve(path), "utf8")
}

describe("default chat tags", () => {
  it("seeds the practical starter set once through a migration", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    const migrationEntry = journal.entries.find((entry) => entry.idx === 56)

    expect(migrationEntry).toEqual({
      idx: 56,
      version: "6",
      when: expect.any(Number),
      tag: "0056_default_chat_tags",
      breakpoints: true,
    })

    const migration = read("drizzle/0056_default_chat_tags.sql")
    expect(migration).toContain("INSERT OR IGNORE INTO `chat_tags`")
    expect(migration).toContain("'Important', 'important', 'rose'")
    expect(migration).toContain("'Blocked', 'blocked', 'violet'")
    expect(migration).toContain("'Follow-up', 'follow-up', 'amber'")
    expect(migration).toContain("'Review', 'review', 'blue'")
    expect(migration).toContain("'Waiting', 'waiting', 'slate'")
  })

  it("matches assigned tag names in sidebar search", () => {
    const sidebar = read("src/renderer/features/sidebar/agents-sidebar.tsx")

    expect(sidebar).toContain(
      "chat.tags.some((tag) => tag.name.toLocaleLowerCase().includes(query))",
    )
  })
})
