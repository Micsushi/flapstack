import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import {
  ensureRealDirectory,
  sha256File,
  validateBundledBinary,
  verifyCachedBinaryDigest,
} from "../scripts/lib/packaged-binary.mjs"
import { resolvePackageBuild } from "../scripts/package-app.mjs"
import { validatePreparedTarget } from "../scripts/prepare-package-resources.mjs"
import { installWhisperDirectory } from "../scripts/prepare-whisper-binary.mjs"

describe("standalone Whisper resource preparation", () => {
  function fixture() {
    const parent = mkdtempSync(join(tmpdir(), "flapstack-whisper-siblings-"))
    const target = join(parent, "win32-x64")
    const staging = join(parent, ".whisper-stage")
    mkdirSync(target)
    mkdirSync(staging)
    executable(staging, "whisper-cli.exe", pe("x64"))
    for (const name of [
      "ggml-base.dll",
      "ggml-cpu.dll",
      "ggml.dll",
      "whisper.dll",
      "whisper.cpp-LICENSE",
    ]) {
      writeFileSync(join(staging, name), "whisper fixture")
    }
    writeFileSync(join(staging, ".whisper-version"), "1.8.6-portable-v1\n")
    writeFileSync(join(target, "whisper-cli.exe"), "previous whisper")
    writeFileSync(join(target, "codex.exe"), "retained codex")
    writeFileSync(join(target, "flapstack-stt-sidecar.exe"), "retained sidecar")
    writeFileSync(join(target, ".stt-sidecar.sha256"), "retained digest")
    return { target, staging }
  }

  it("rejects unexpected downloaded files before changing existing resources", () => {
    const { target, staging } = fixture()
    writeFileSync(join(staging, "codex.exe"), "unexpected download")
    expect(() => installWhisperDirectory(staging, target, "win32-x64")).toThrow(/unexpected/i)
    expect(readFileSync(join(target, "codex.exe"), "utf8")).toBe("retained codex")
    expect(readFileSync(join(target, "whisper-cli.exe"), "utf8")).toBe("previous whisper")
  })
})

const requireFromTest = createRequire(import.meta.url)

function macho(arch: "arm64" | "x64") {
  const buffer = Buffer.alloc(32)
  buffer.writeUInt32BE(0xcffaedfe, 0)
  buffer.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4)
  return buffer
}

function pe(arch: "arm64" | "x64" | "x86", peOffset = 128) {
  const buffer = Buffer.alloc(peOffset + 8)
  buffer.write("MZ", 0, "ascii")
  buffer.writeUInt32LE(peOffset, 0x3c)
  buffer.write("PE\0\0", peOffset, "ascii")
  const machine = arch === "arm64" ? 0xaa64 : arch === "x86" ? 0x014c : 0x8664
  buffer.writeUInt16LE(machine, peOffset + 4)
  return buffer
}

function executable(dir: string, name: string, contents: Buffer) {
  const file = join(dir, name)
  writeFileSync(file, contents)
  chmodSync(file, 0o755)
  return file
}

describe("packaged harness preparation", () => {
  it("requires a digest-verified Codex code-mode host in Windows package resources", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-prepared-resources-"))
    const target = join(root, "win32-x64")
    mkdirSync(target)
    const binaries = [
      "claude.exe",
      "codex.exe",
      "codex-code-mode-host.exe",
      "codex-command-runner.exe",
      "codex-windows-sandbox-setup.exe",
      "flapstack-stt-sidecar.exe",
    ]
    for (const name of binaries) executable(target, name, pe("x64"))
    for (const name of [
      "ggml-base.dll",
      "ggml-cpu.dll",
      "ggml.dll",
      "whisper-cli.exe",
      "whisper.dll",
      "flapstack-stt-sidecar-LICENSE",
      "transcribe.cpp-LICENSE",
      "whisper.cpp-LICENSE",
      ".whisper-version",
    ])
      writeFileSync(join(target, name), "fixture")
    writeFileSync(join(target, ".transcribe-version"), "0.1.3\n")
    writeFileSync(join(target, ".codex-asset.sha256"), `${"a".repeat(64)}\n`)
    for (const [binary, marker] of [
      ["codex.exe", ".codex-binary.sha256"],
      ["codex-code-mode-host.exe", ".codex-code-mode-host.sha256"],
      ["codex-command-runner.exe", ".codex-command-runner.sha256"],
      ["codex-windows-sandbox-setup.exe", ".codex-windows-sandbox-setup.sha256"],
      ["flapstack-stt-sidecar.exe", ".stt-sidecar.sha256"],
    ])
      writeFileSync(join(target, marker), `${await sha256File(join(target, binary))}\n`)

    await expect(validatePreparedTarget("win32-x64", root)).resolves.toBeUndefined()
    writeFileSync(join(target, "codex-code-mode-host.exe"), pe("x64", 256))
    await expect(validatePreparedTarget("win32-x64", root)).rejects.toThrow(
      /code-mode host digest validation failed/i,
    )
  })

  it("requires Authenticode for Windows release packages", () => {
    expect(
      resolvePackageBuild({
        platform: "win32",
        architectures: ["x64"],
        channel: "release",
      }),
    ).toMatchObject({
      targets: ["win32-x64"],
      channel: "release",
      builderArgs: expect.arrayContaining([
        "--win",
        "--x64",
        "--config=electron-builder.release.win.cjs",
        "--publish=never",
      ]),
    })
    const releaseConfig = requireFromTest("../electron-builder.release.win.cjs")
    expect(releaseConfig).toMatchObject({
      forceCodeSigning: true,
      nsis: {
        artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
      },
      portable: {
        artifactName: "${productName}-Portable-${version}-${arch}.${ext}",
      },
    })
    expect(releaseConfig.artifactName).toBeUndefined()
  })

  it("rejects invalid native CLIs using the host package format", () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-binaries-"))
    const platform = process.platform === "win32" ? "win32-x64" : "darwin-arm64"
    const valid = executable(
      dir,
      process.platform === "win32" ? "valid.exe" : "valid",
      process.platform === "win32" ? pe("x64") : macho("arm64"),
    )
    const link = join(dir, "link")
    const directory = join(dir, "directory")
    mkdirSync(directory)
    const nonExecutable = join(dir, "non-executable")
    writeFileSync(nonExecutable, macho("arm64"))
    const wrongArch = executable(
      dir,
      "wrong-arch",
      process.platform === "win32" ? pe("arm64") : macho("x64"),
    )

    expect(validateBundledBinary(join(dir, "missing"), platform).ok).toBe(false)
    if (fileSymlinksSupported) {
      symlinkSync(valid, link)
      expect(validateBundledBinary(link, platform).errors.join(" ")).toContain("symlink")
    }
    expect(validateBundledBinary(directory, platform).errors.join(" ")).toContain("regular file")
    if (process.platform !== "win32") {
      expect(validateBundledBinary(nonExecutable, platform).errors.join(" ")).toContain(
        "executable",
      )
    }
    expect(validateBundledBinary(wrongArch, platform).errors.join(" ")).toContain(
      "wrong architecture",
    )
  })

  it("recomputes the cached binary digest instead of trusting its marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-binaries-"))
    const platform = process.platform === "win32" ? "win32-x64" : "darwin-arm64"
    const initial = process.platform === "win32" ? pe("x64") : macho("arm64")
    const binary = executable(dir, "codex", initial)
    const marker = join(dir, ".codex-binary.sha256")
    writeFileSync(marker, `${await sha256File(binary)}\n`)

    await expect(verifyCachedBinaryDigest(binary, platform, marker)).resolves.toBe(true)
    writeFileSync(binary, Buffer.concat([initial, Buffer.from("tampered")]))
    await expect(verifyCachedBinaryDigest(binary, platform, marker)).resolves.toBe(false)
  })

  it("rejects a symlinked CLI target directory before downloaders can write through it", () => {
    const parent = mkdtempSync(join(tmpdir(), "flapstack-cli-root-"))
    const outside = join(parent, "outside")
    const linkedTarget = join(parent, "darwin-arm64")
    mkdirSync(outside)
    symlinkSync(outside, linkedTarget, process.platform === "win32" ? "junction" : undefined)

    expect(() => ensureRealDirectory(linkedTarget)).toThrow("must be a real directory")
    expect(lstatSync(linkedTarget).isSymbolicLink()).toBe(true)
  })
})
