import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { stableRustToolchainName } from "../scripts/prepare-stt-sidecar.mjs"

describe("STT sidecar toolchain fallback", () => {
  it("uses the native Rust host triple on Windows, macOS, and Linux", () => {
    expect(stableRustToolchainName("win32", "x64")).toBe("stable-x86_64-pc-windows-msvc")
    expect(stableRustToolchainName("darwin", "arm64")).toBe("stable-aarch64-apple-darwin")
    expect(stableRustToolchainName("linux", "x64")).toBe("stable-x86_64-unknown-linux-gnu")
  })
})
