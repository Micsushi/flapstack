import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents mobile companion recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-mobile-companion-tab.tsx",
    ),
    "utf8",
  )

  it("keeps discovery failures visible and gates authority changes", () => {
    expect(source).toContain("Mobile companion discovery unavailable:")
    expect(source).toContain("Paired devices unavailable.")
    expect(source).toContain("Authority grants unavailable.")
    expect(source).toContain("authorityReadUnavailable")
    expect(source).toContain("refresh()")
    expect(source).toContain("utils.projects.list.invalidate(undefined, undefined, { throwOnError })")
    expect(source).toContain('role="alert"')
  })
})
