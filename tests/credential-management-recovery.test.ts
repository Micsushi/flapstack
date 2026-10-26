import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("credential management recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/credential-management.tsx",
    ),
    "utf8",
  )

  it("does not treat failed credential reads as unconfigured writable state", () => {
    expect(source).toContain('return "Status unavailable"')
    expect(source).toContain("Credential status unavailable:")
    expect(source).toContain("retryCredentialReads()")
    expect(source).toContain("credentialReadsUnavailable")
    expect(source).toContain('role="alert"')
  })
})
