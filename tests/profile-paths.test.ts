import { describe, expect, it } from "vitest"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  daemonServiceIdForConfig,
  isLaunchctlServiceNotFound,
} from "../src/main/lib/usage-daemon/platform"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  electronAppDataRoot,
  resolveDevMcpDescriptorPath,
  resolveDevMcpProfile,
  usageDaemonSmokeProfilePath,
} from "../scripts/lib/profile-paths.mjs"

describe("Flapstack profile paths", () => {
  it("does not treat permission or process-launch failures as an absent smoke service", () => {
    expect(isLaunchctlServiceNotFound({ status: 113 })).toBe(true)
    expect(isLaunchctlServiceNotFound({ status: 3 })).toBe(false)
    expect(isLaunchctlServiceNotFound({ status: 1 })).toBe(false)
    expect(isLaunchctlServiceNotFound({ code: "ENOENT" })).toBe(false)
  })
  it("gives repeated usage-daemon smokes distinct service identities within their own temp root", () => {
    const root = join(tmpdir(), "flapstack-smoke-fixture")
    const profiles = [usageDaemonSmokeProfilePath(root), usageDaemonSmokeProfilePath(root)]
    expect(profiles.every((profile) => dirname(profile) === root)).toBe(true)
    const serviceIds = profiles.map((profile) => daemonServiceIdForConfig(join(profile, "data")))
    expect(new Set(serviceIds).size).toBe(2)
    expect(
      serviceIds.every((id) => /^flapstack-preview-usage-exit-smoke-[a-f0-9-]{36}$/.test(id!)),
    ).toBe(true)
    expect(serviceIds).not.toContain("flapstack-preview-usage-exit-smoke")
  })
  it("uses the native Windows roaming application data root", () => {
    expect(
      electronAppDataRoot({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
        home: "C:\\Users\\test",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming")
  })

  it("resolves isolated profiles and descriptors without a POSIX path", () => {
    const env = {
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      FLAPSTACK_DEV_INSTANCE: "windows proof",
    }
    const profile = resolveDevMcpProfile(env)
    expect(profile).toBe("Flapstack Dev windows-proof")
    expect(
      resolveDevMcpDescriptorPath(profile, {
        platform: "win32",
        env,
        home: "C:\\Users\\test",
      }),
    ).toBe(
      "C:\\Users\\test\\AppData\\Roaming\\Flapstack Dev windows-proof\\dev-test-control-mcp.json",
    )
  })
})
