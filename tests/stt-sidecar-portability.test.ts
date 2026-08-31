import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  resolveSttBuildEnv,
  resolveTranscribeLicense,
  stableRustToolchainName,
} from "../scripts/prepare-stt-sidecar.mjs"

describe("STT sidecar toolchain fallback", () => {
  it("uses the native Rust host triple on Windows, macOS, and Linux", () => {
    expect(stableRustToolchainName("win32", "x64")).toBe("stable-x86_64-pc-windows-msvc")
    expect(stableRustToolchainName("darwin", "arm64")).toBe("stable-aarch64-apple-darwin")
    expect(stableRustToolchainName("linux", "x64")).toBe("stable-x86_64-unknown-linux-gnu")
  })

  it("uses a portable CPU baseline for Linux arm64", () => {
    expect(resolveSttBuildEnv("linux-arm64", {})).toEqual({
      TRANSCRIBE_CMAKE_ARGS: "-DGGML_NATIVE=OFF",
    })
    expect(
      resolveSttBuildEnv("linux-arm64", {
        TRANSCRIBE_CMAKE_ARGS: "-DTRANSCRIBE_USE_OPENMP=OFF",
        CMAKE_ARGS: "-DGGML_NATIVE=ON",
      }),
    ).toEqual({
      TRANSCRIBE_CMAKE_ARGS: "-DTRANSCRIBE_USE_OPENMP=OFF -DGGML_NATIVE=OFF",
      CMAKE_ARGS: "-DGGML_NATIVE=ON -DGGML_NATIVE=OFF",
    })
    expect(resolveSttBuildEnv("linux-x64", {})).toEqual({})
  })

  it("resolves the locked dependency license from Cargo metadata", () => {
    const registryPackage = mkdtempSync(join(tmpdir(), "flapstack-transcribe-license-"))
    const manifest = join(registryPackage, "Cargo.toml")
    const license = join(registryPackage, "LICENSE")
    writeFileSync(manifest, '[package]\nname = "transcribe-cpp"\n')
    writeFileSync(license, "MIT")
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        packages: [{ name: "transcribe-cpp", version: "0.1.3", manifest_path: manifest }],
      }),
    }))

    expect(resolveTranscribeLicense({ command: "cargo", env: {} }, runner)).toBe(license)
    expect(runner).toHaveBeenCalledWith(
      "cargo",
      ["metadata", "--format-version=1", "--locked", "--offline"],
      expect.objectContaining({ encoding: "utf8" }),
    )
  })

  it("rejects a non-regular dependency license", () => {
    const registryPackage = mkdtempSync(join(tmpdir(), "flapstack-transcribe-license-"))
    const manifest = join(registryPackage, "Cargo.toml")
    writeFileSync(manifest, '[package]\nname = "transcribe-cpp"\n')
    const license = join(registryPackage, "LICENSE")
    mkdirSync(license)
    expect(() =>
      resolveTranscribeLicense({ command: "cargo", env: {} }, () => ({
        status: 0,
        stdout: JSON.stringify({
          packages: [{ name: "transcribe-cpp", version: "0.1.3", manifest_path: manifest }],
        }),
      })),
    ).toThrow(/regular file/)
  })
})
