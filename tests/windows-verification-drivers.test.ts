import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function source(name: string) {
  return readFileSync(resolve("scripts", name), "utf8")
}

describe("Windows acceptance driver safety contracts", () => {
  it("uses a no-focus second-instance deep link without changing protocol registration", () => {
    const driver = source("verify-windows-deep-link.mjs")
    expect(driver).toContain('FLAPSTACK_NO_FOCUS: "1"')
    expect(driver).toContain('"--no-focus"')
    expect(driver).toContain("before.app.executablePath")
    expect(driver).toContain("after.app.windowCount !== before.app.windowCount")
    expect(driver).not.toContain("setAsDefaultProtocolClient")
    expect(driver).not.toMatch(/\breg(?:\.exe)?\b/i)
  })

  it("limits abrupt recovery to exact checkout ownership and preserves an unrelated sentinel", () => {
    const driver = source("verify-windows-dev-recovery.mjs")
    expect(driver).toContain("findOwnedWindowsProcessIds")
    expect(driver).toContain("windowsTaskkillArgs(pid, true)")
    expect(driver).toContain("scripts/verify-dev-instance.mjs")
    expect(driver).toContain("process.kill(sentinelPid, 0)")
    expect(driver).not.toMatch(/taskkill[^]*\/IM/i)
  })

  it("composes deep-link, DPAPI, terminal, and isolated scheduler evidence", () => {
    const driver = source("verify-windows-core.mjs")
    expect(driver).toContain("verifyWindowsDeepLink")
    expect(driver).toContain("get_credential_status")
    expect(driver).toContain("tests/windows-native-platform-live.test.ts")
    expect(driver).toContain("tests/windows-terminal-profiles-live.test.ts")
  })
})
