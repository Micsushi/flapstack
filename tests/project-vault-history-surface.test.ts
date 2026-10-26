import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("project vault history recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/features/project-vault/project-vault-view.tsx"),
    "utf8",
  )

  it("keeps version history and backup preview failures retryable", () => {
    expect(source).toContain("Version history unavailable:")
    expect(source).toContain("Backup preview unavailable:")
    expect(source).toContain("backupsQuery.refetch()")
    expect(source).toContain("backupQuery.refetch()")
    expect(source).toContain("disabled={backupsQuery.isFetching}")
    expect(source).toContain("disabled={backupQuery.isFetching}")
    expect(source).toContain("Retry")
    expect(source).toContain("Retry preview")
  })
})
