import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Profile Studio recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/agents-profiles-studio-tab.tsx",
    ),
    "utf8",
  )

  it("keeps profile reads visible and gates mutations on unknown state", () => {
    expect(source).toContain("Profile Studio data unavailable:")
    expect(source).toContain("Agent profiles unavailable.")
    expect(source).toContain("retryReads()")
    expect(source).toContain("if (selectedId && selected) retries.push(details.refetch())")
    expect(source).toContain("if (workflowRunId.trim()) retries.push(workflowBindings.refetch())")
    expect(source).toContain("profileMutationUnavailable")
    expect(source).toContain('role="alert"')
  })
})
