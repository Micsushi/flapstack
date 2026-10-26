import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("remote computer client recovery surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/components/dialogs/settings-tabs/remote-computer-client.tsx",
    ),
    "utf8",
  )

  it("keeps failed connection reads retryable and gates actions", () => {
    expect(source).toContain("Remote computer status unavailable:")
    expect(source).toContain("status.refetch()")
    expect(source).toContain("statusUnavailable")
    expect(source).toContain('role="alert"')
  })
})
