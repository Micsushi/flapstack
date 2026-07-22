import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  electronAppDataRoot,
  resolveDevMcpDescriptorPath,
  resolveDevMcpProfile,
} from "../scripts/lib/profile-paths.mjs"

describe("Flapstack profile paths", () => {
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
