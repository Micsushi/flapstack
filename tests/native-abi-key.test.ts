import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { nativeAbiMarker } from "../scripts/native-abi-key.mjs"

describe("native ABI marker", () => {
  it("changes when Electron or a native dependency changes", () => {
    const base = {
      target: "electron",
      nodeAbi: "127",
      electronVersion: "39.4.0",
      nativeModuleVersions: { "better-sqlite3": "12.6.0", "node-pty": "1.1.0" },
    }
    expect(nativeAbiMarker(base)).not.toBe(nativeAbiMarker({ ...base, electronVersion: "39.4.1" }))
    expect(nativeAbiMarker(base)).not.toBe(
      nativeAbiMarker({
        ...base,
        nativeModuleVersions: { ...base.nativeModuleVersions, "node-pty": "1.2.0" },
      }),
    )
  })
})
