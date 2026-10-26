import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Models recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx"),
    "utf8",
  )

  it("keeps account and credential reads truthful and retryable", () => {
    expect(source).toContain("Anthropic account status unavailable:")
    expect(source).toContain("retryAccountReads()")
    expect(source).toContain("Status unavailable")
    expect(source).toContain("Codex API key status unavailable:")
    expect(source).toContain("refetchCodexCredential()")
    expect(source).toContain("codexCredentialStatusUnavailable")
    expect(source).toContain('role="alert"')
  })
})
