import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Skills recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-skills-tab.tsx"),
    "utf8",
  )

  it("does not treat failed discovery as an empty writable registry", () => {
    expect(source).toContain("canModifyItems")
    expect(source).toContain("Skills and commands could not be loaded.")
    expect(source).toContain("Refresh skills and commands before creating an item")
    expect(source).toContain("Refresh the skills and commands list before creating an item.")
    expect(source).toContain("Retry lists")
    expect(source).toContain('role="alert"')
  })
})
