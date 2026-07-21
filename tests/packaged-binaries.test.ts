import {
  chmodSync,
  existsSync,
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
import {
  ensureRealDirectory,
  inspectBinaryArchitecture,
  replaceDirectoryAtomically,
  sha256File,
  validateBundledBinary,
  verifyCachedBinaryDigest,
} from "../scripts/lib/packaged-binary.mjs"
import { resolvePackageBuild } from "../scripts/package-app.mjs"
import { resolvePackageTargets } from "../scripts/prepare-package-resources.mjs"
import { validateWhisperDirectory } from "../scripts/prepare-whisper-binary.mjs"

const requireFromTest = createRequire(import.meta.url)

function macho(arch: "arm64" | "x64") {
  const buffer = Buffer.alloc(32)
  buffer.writeUInt32BE(0xcffaedfe, 0)
  buffer.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4)
  return buffer
}

function elf(arch: "arm64" | "x64") {
  const buffer = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(buffer)
  buffer[5] = 1
  buffer.writeUInt16LE(arch === "arm64" ? 183 : 62, 18)
  return buffer
}

function pe(arch: "arm64" | "x64") {
  const buffer = Buffer.alloc(256)
  buffer.write("MZ", 0, "ascii")
  buffer.writeUInt32LE(128, 0x3c)
  buffer.write("PE\0\0", 128, "ascii")
  buffer.writeUInt16LE(arch === "arm64" ? 0xaa64 : 0x8664, 132)
  return buffer
}

function executable(dir: string, name: string, contents: Buffer) {
  const file = join(dir, name)
  writeFileSync(file, contents)
  chmodSync(file, 0o755)
  return file
}

describe("packaged harness preparation", () => {
  it("requires exact resource targets instead of deriving architectures from the host", () => {
    expect(resolvePackageTargets(["darwin-arm64", "darwin-x64"])).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ])
    expect(resolvePackageTargets(["win32-x64"])).toEqual(["win32-x64"])
    expect(resolvePackageTargets(["linux-x64", "linux-arm64"])).toEqual([
      "linux-x64",
      "linux-arm64",
    ])
    expect(() => resolvePackageTargets([])).toThrow("explicit platform and architecture")
    expect(() => resolvePackageTargets(["linux"])).toThrow("Unsupported package target")
  })

  it("shares macOS, Windows, and Linux architecture selection with electron-builder", () => {
    expect(
      resolvePackageBuild({ platform: "darwin", architectures: ["arm64", "x64"] }),
    ).toMatchObject({
      targets: ["darwin-arm64", "darwin-x64"],
      builderArgs: ["--mac", "--arm64", "--x64"],
    })
    expect(resolvePackageBuild({ platform: "win32", architectures: ["x64"] })).toMatchObject({
      targets: ["win32-x64"],
      builderArgs: ["--win", "--x64"],
    })
    expect(resolvePackageBuild({ platform: "linux", architectures: ["x64"] })).toMatchObject({
      targets: ["linux-x64"],
      builderArgs: ["--linux", "--x64"],
    })
    expect(resolvePackageBuild({ platform: "linux", architectures: ["arm64"] })).toMatchObject({
      targets: ["linux-arm64"],
      builderArgs: ["--linux", "--arm64"],
    })
  })

  it("keeps generic dist preparation aligned with every builder architecture", () => {
    expect(resolvePackageBuild({}, { platform: "darwin", arch: "arm64" })).toMatchObject({
      targets: ["darwin-arm64", "darwin-x64"],
      builderArgs: ["--mac", "--arm64", "--x64"],
    })
    expect(resolvePackageBuild({}, { platform: "linux", arch: "arm64" })).toMatchObject({
      targets: ["linux-arm64"],
      builderArgs: ["--linux", "--arm64"],
    })
    expect(() => resolvePackageBuild({ platform: "linux" })).toThrow(
      "requires an explicit architecture",
    )
  })

  it("gives macOS preview packages a separate app, protocol, and output identity", () => {
    expect(
      resolvePackageBuild({
        platform: "darwin",
        architectures: ["arm64"],
        dir: true,
        channel: "preview",
      }),
    ).toMatchObject({
      targets: ["darwin-arm64"],
      builderArgs: expect.arrayContaining([
        "--mac",
        "--arm64",
        "--dir",
        "--config=electron-builder.preview.mac.cjs",
      ]),
    })
  })

  it("uses the explicit unsigned config for macOS beta release packages", () => {
    expect(
      resolvePackageBuild({
        platform: "darwin",
        architectures: ["arm64", "x64"],
        channel: "release",
      }),
    ).toMatchObject({
      targets: ["darwin-arm64", "darwin-x64"],
      builderArgs: ["--mac", "--arm64", "--x64", "--config=electron-builder.release.mac.cjs"],
    })

    expect(requireFromTest("../electron-builder.release.mac.cjs")).toMatchObject({
      forceCodeSigning: false,
      artifactName: "${productName}-${version}-${arch}.${ext}",
      mac: {
        identity: null,
        notarize: false,
        target: [{ target: "dmg", arch: ["arm64", "x64"] }],
      },
    })
  })

  it("recognizes Mach-O, ELF, and PE architectures", () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-binaries-"))
    expect(inspectBinaryArchitecture(executable(dir, "mac", macho("arm64")))).toMatchObject({
      format: "mach-o",
      architectures: ["arm64"],
    })
    expect(inspectBinaryArchitecture(executable(dir, "linux", elf("x64")))).toMatchObject({
      format: "elf",
      architectures: ["x64"],
    })
    expect(inspectBinaryArchitecture(executable(dir, "windows.exe", pe("x64")))).toMatchObject({
      format: "pe",
      architectures: ["x64"],
    })
  })

  it("rejects missing, symlinked, non-file, non-executable, and wrong-architecture CLIs", () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-binaries-"))
    const valid = executable(dir, "valid", macho("arm64"))
    const link = join(dir, "link")
    symlinkSync(valid, link)
    const directory = join(dir, "directory")
    mkdirSync(directory)
    const nonExecutable = join(dir, "non-executable")
    writeFileSync(nonExecutable, macho("arm64"))
    const wrongArch = executable(dir, "wrong-arch", macho("x64"))

    expect(validateBundledBinary(join(dir, "missing"), "darwin-arm64").ok).toBe(false)
    expect(validateBundledBinary(link, "darwin-arm64").errors.join(" ")).toContain("symlink")
    expect(validateBundledBinary(directory, "darwin-arm64").errors.join(" ")).toContain(
      "regular file",
    )
    expect(validateBundledBinary(nonExecutable, "darwin-arm64").errors.join(" ")).toContain(
      "executable",
    )
    expect(validateBundledBinary(wrongArch, "darwin-arm64").errors.join(" ")).toContain(
      "wrong architecture",
    )
  })

  it("recomputes the cached binary digest instead of trusting its marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flapstack-binaries-"))
    const binary = executable(dir, "codex", macho("arm64"))
    const marker = join(dir, ".codex-binary.sha256")
    writeFileSync(marker, `${await sha256File(binary)}\n`)

    await expect(verifyCachedBinaryDigest(binary, "darwin-arm64", marker)).resolves.toBe(true)
    writeFileSync(binary, Buffer.concat([macho("arm64"), Buffer.from("tampered")]))
    await expect(verifyCachedBinaryDigest(binary, "darwin-arm64", marker)).resolves.toBe(false)
  })

  it("replaces stale Whisper resources without following a destination symlink", () => {
    const parent = mkdtempSync(join(tmpdir(), "flapstack-whisper-stage-"))
    const target = join(parent, "darwin-arm64")
    const staging = join(parent, ".whisper-darwin-arm64-stage")
    const outside = join(parent, "outside")
    mkdirSync(target)
    mkdirSync(staging)
    writeFileSync(join(target, "stale-extra"), "must disappear")
    writeFileSync(outside, "outside remains")
    symlinkSync(outside, join(target, "whisper-cli"))

    executable(staging, "whisper-cli", macho("arm64"))
    writeFileSync(join(staging, "whisper.cpp-LICENSE"), "license")
    writeFileSync(join(staging, ".whisper-version"), "1.8.6-portable-v1\n")

    expect(() => validateWhisperDirectory(target, "darwin-arm64")).toThrow()
    validateWhisperDirectory(staging, "darwin-arm64")
    replaceDirectoryAtomically(staging, target)
    validateWhisperDirectory(target, "darwin-arm64")

    expect(existsSync(join(target, "stale-extra"))).toBe(false)
    expect(lstatSync(join(target, "whisper-cli")).isSymbolicLink()).toBe(false)
    expect(readFileSync(outside, "utf8")).toBe("outside remains")
  })

  it("rejects a symlinked CLI target directory before downloaders can write through it", () => {
    const parent = mkdtempSync(join(tmpdir(), "flapstack-cli-root-"))
    const outside = join(parent, "outside")
    const linkedTarget = join(parent, "darwin-arm64")
    mkdirSync(outside)
    symlinkSync(outside, linkedTarget)

    expect(() => ensureRealDirectory(linkedTarget)).toThrow("must be a real directory")
    expect(lstatSync(linkedTarget).isSymbolicLink()).toBe(true)
  })
})
