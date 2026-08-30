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
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import {
  ensureRealDirectory,
  inspectBinaryArchitecture,
  replaceDirectoryAtomically,
  sha256File,
  validateBundledBinary,
  verifyCachedBinaryDigest,
} from "../scripts/lib/packaged-binary.mjs"
import { resolvePackageBuild } from "../scripts/package-app.mjs"
import { runMacNativeModulesSmoke } from "../scripts/inspect-packaged-binaries.mjs"
import { resolveDarwinTargetPackages } from "../scripts/lib/darwin-target-dependencies.mjs"
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
  it("loads packaged macOS native modules through the bundled Electron runtime", () => {
    let invocation: {
      runtime: string
      args: string[]
      options: { env: NodeJS.ProcessEnv; timeout: number }
    } | null = null
    runMacNativeModulesSmoke(
      "/Applications/Flapstack.app/Contents/MacOS/Flapstack",
      "/resources/app.asar/node_modules",
      (runtime: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        invocation = { runtime, args, options }
        return { status: 0, stdout: "native-modules-ok", stderr: "" }
      },
    )

    expect(invocation).toMatchObject({
      runtime: "/Applications/Flapstack.app/Contents/MacOS/Flapstack",
      options: { env: { ELECTRON_RUN_AS_NODE: "1" }, timeout: 180_000 },
    })
    expect(invocation!.args[1]).toContain("/resources/app.asar/node_modules/better-sqlite3")
    expect(invocation!.args[1]).toContain("/resources/app.asar/node_modules/sharp")
    expect(invocation!.args[1]).toContain("/resources/app.asar/node_modules/node-pty")
  })

  it("pins optional native packages for every macOS package architecture", () => {
    const lock = requireFromTest("../package-lock.json")
    expect(resolveDarwinTargetPackages(["darwin-x64", "darwin-arm64"], lock)).toEqual([
      expect.objectContaining({ name: "@img/sharp-darwin-x64", target: "darwin-x64" }),
      expect.objectContaining({ name: "@img/sharp-libvips-darwin-x64", target: "darwin-x64" }),
      expect.objectContaining({ name: "@openai/codex-darwin-x64", target: "darwin-x64" }),
      expect.objectContaining({ name: "@img/sharp-darwin-arm64", target: "darwin-arm64" }),
      expect.objectContaining({ name: "@img/sharp-libvips-darwin-arm64", target: "darwin-arm64" }),
      expect.objectContaining({ name: "@openai/codex-darwin-arm64", target: "darwin-arm64" }),
    ])
  })

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
      channel: "preview",
      builderArgs: expect.arrayContaining([
        "--mac",
        "--arm64",
        "--dir",
        "--config=electron-builder.preview.mac.cjs",
      ]),
    })
    expect(requireFromTest("../electron-builder.preview.mac.cjs").npmRebuild).toBe(true)
  })

  it("gives Windows preview packages a separate app, protocol, and output identity", () => {
    expect(
      resolvePackageBuild({
        platform: "win32",
        architectures: ["x64"],
        dir: true,
        channel: "preview",
      }),
    ).toMatchObject({
      targets: ["win32-x64"],
      channel: "preview",
      builderArgs: expect.arrayContaining([
        "--win",
        "--x64",
        "--dir",
        "--config=electron-builder.preview.win.cjs",
      ]),
    })
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

  it("keeps ONNX Runtime payload filtering target- and architecture-specific", () => {
    const packageJson = requireFromTest("../package.json")
    expect(packageJson.build.files).toEqual(
      expect.arrayContaining([
        "!node_modules/node-pty/prebuilds/**/*",
        "!node_modules/node-pty/third_party/**/*",
        "!node_modules/better-sqlite3/build/Release/test_extension.node",
        "!node_modules/@anthropic-ai/claude-agent-sdk-*/**/*",
        "!node_modules/**/{test,tests,__tests__}/**/*",
        "!node_modules/**/*.test.{js,cjs,mjs,ts,tsx}",
        "!**/*.{obj,pdb,lib,exp,iobj,ipdb,ilk}",
      ]),
    )
    expect(packageJson.build.files).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^!node_modules\/onnxruntime-node\/bin\/napi-v3\/(?:darwin|linux|win32)\//,
        ),
      ]),
    )

    expect(packageJson.build.win.files).toEqual([
      ...packageJson.build.files,
      "!node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/linux/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/win32/!(${arch})/**/*",
    ])
    expect(packageJson.build.mac.files).toEqual([
      ...packageJson.build.files,
      "!node_modules/@img/sharp-darwin-!(${arch})/**/*",
      "!node_modules/@img/sharp-libvips-darwin-!(${arch})/**/*",
      "!node_modules/@openai/codex-darwin-!(${arch})/**/*",
      "!node_modules/node-pty/bin/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/linux/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/win32/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/darwin/!(${arch})/**/*",
    ])
    expect(packageJson.build.linux.files).toEqual([
      ...packageJson.build.files,
      "!node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/win32/**/*",
      "!node_modules/onnxruntime-node/bin/napi-v3/linux/!(${arch})/**/*",
    ])

    expect(requireFromTest("../electron-builder.preview.win.cjs").win.files).toEqual(
      packageJson.build.win.files,
    )
    expect(requireFromTest("../electron-builder.release.win.cjs").win.files).toEqual(
      packageJson.build.win.files,
    )
    expect(requireFromTest("../electron-builder.preview.mac.cjs").mac.files).toEqual(
      packageJson.build.mac.files,
    )
    expect(requireFromTest("../electron-builder.release.mac.cjs").mac.files).toEqual(
      packageJson.build.mac.files,
    )

    const { FileMatcher } = requireFromTest("app-builder-lib/out/fileMatcher.js")
    const targets = [
      ["win", "win32", "x64"],
      ["mac", "darwin", "x64"],
      ["mac", "darwin", "arm64"],
      ["linux", "linux", "x64"],
      ["linux", "linux", "arm64"],
    ] as const
    for (const [configKey, platform, architecture] of targets) {
      const appMatcher = new FileMatcher(
        process.cwd(),
        process.cwd(),
        (pattern: string) => pattern.replaceAll("${arch}", architecture),
        packageJson.build[configKey].files,
      )
      const appFilter = appMatcher.createFilter()
      expect(
        appFilter(
          join(process.cwd(), "native", "stt-sidecar", "target", "release", "build.exe"),
          lstatSync(process.cwd()),
        ),
      ).toBe(false)
      expect(
        appFilter(join(process.cwd(), "out", "main", "index.js"), lstatSync(process.cwd())),
      ).toBe(true)

      const matcher = new FileMatcher(
        process.cwd(),
        process.cwd(),
        (pattern: string) => pattern.replaceAll("${arch}", architecture),
        ["**/*", ...packageJson.build[configKey].files],
      )
      const filter = matcher.createFilter()
      expect(
        filter(
          join(
            process.cwd(),
            "node_modules",
            "@anthropic-ai",
            "claude-agent-sdk-darwin-arm64",
            "claude",
          ),
          lstatSync(
            join(
              process.cwd(),
              "node_modules",
              "@anthropic-ai",
              "claude-agent-sdk-darwin-arm64",
              "claude",
            ),
          ),
        ),
      ).toBe(false)
      const keptBindings = ["win32", "darwin", "linux"].flatMap((candidatePlatform) =>
        ["x64", "arm64"]
          .filter((candidateArchitecture) => {
            const binding = join(
              process.cwd(),
              "node_modules",
              "onnxruntime-node",
              "bin",
              "napi-v3",
              candidatePlatform,
              candidateArchitecture,
              "onnxruntime_binding.node",
            )
            return filter(binding, lstatSync(binding))
          })
          .map((candidateArchitecture) => `${candidatePlatform}-${candidateArchitecture}`),
      )
      expect(keptBindings).toEqual([`${platform}-${architecture}`])
      if (platform === "darwin") {
        expect(
          filter(
            join(
              process.cwd(),
              "node_modules",
              "node-pty",
              "bin",
              "darwin-arm64-140",
              "node-pty.node",
            ),
            lstatSync(process.cwd()),
          ),
        ).toBe(false)
        const keptSharpArchitectures = ["x64", "arm64"].filter((candidateArchitecture) =>
          filter(
            join(
              process.cwd(),
              "node_modules",
              "@img",
              `sharp-darwin-${candidateArchitecture}`,
              "lib",
              `sharp-darwin-${candidateArchitecture}-0.35.3.node`,
            ),
            lstatSync(process.cwd()),
          ),
        )
        expect(keptSharpArchitectures).toEqual([architecture])
        const keptCodexArchitectures = ["x64", "arm64"].filter((candidateArchitecture) =>
          filter(
            join(
              process.cwd(),
              "node_modules",
              "@openai",
              `codex-darwin-${candidateArchitecture}`,
              "vendor",
              candidateArchitecture === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin",
              "bin",
              "codex",
            ),
            lstatSync(process.cwd()),
          ),
        )
        expect(keptCodexArchitectures).toEqual([architecture])
      }
    }
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
      builderArgs: [
        "--mac",
        "--arm64",
        "--x64",
        "--config=electron-builder.release.mac.cjs",
        "--publish=never",
      ],
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
    expect(
      inspectBinaryArchitecture(executable(dir, "windows-elevate.exe", pe("x86"))),
    ).toMatchObject({
      format: "pe",
      architectures: ["x86"],
    })
    expect(
      inspectBinaryArchitecture(executable(dir, "renamed.data", pe("x64", 8192))),
    ).toMatchObject({
      format: "pe",
      architectures: ["x64"],
    })
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

  it.skipIf(!fileSymlinksSupported)(
    "replaces stale Whisper resources without following a destination symlink",
    () => {
      const parent = mkdtempSync(join(tmpdir(), "flapstack-whisper-stage-"))
      const platform = process.platform === "win32" ? "win32-x64" : "darwin-arm64"
      const target = join(parent, platform)
      const staging = join(parent, `.whisper-${platform}-stage`)
      const outside = join(parent, "outside")
      mkdirSync(target)
      mkdirSync(staging)
      writeFileSync(join(target, "stale-extra"), "must disappear")
      writeFileSync(outside, "outside remains")
      const cliName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
      symlinkSync(outside, join(target, cliName))

      executable(staging, cliName, process.platform === "win32" ? pe("x64") : macho("arm64"))
      writeFileSync(join(staging, "whisper.cpp-LICENSE"), "license")
      writeFileSync(join(staging, ".whisper-version"), "1.8.6-portable-v1\n")
      if (process.platform === "win32") {
        for (const dll of ["ggml-base.dll", "ggml-cpu.dll", "ggml.dll", "whisper.dll"]) {
          writeFileSync(join(staging, dll), "fixture")
        }
      }

      expect(() => validateWhisperDirectory(target, platform)).toThrow()
      validateWhisperDirectory(staging, platform)
      replaceDirectoryAtomically(staging, target)
      validateWhisperDirectory(target, platform)

      expect(existsSync(join(target, "stale-extra"))).toBe(false)
      expect(lstatSync(join(target, cliName)).isSymbolicLink()).toBe(false)
      expect(readFileSync(outside, "utf8")).toBe("outside remains")
    },
  )

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
