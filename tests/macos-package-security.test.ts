import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
// @ts-expect-error JavaScript package-audit helper intentionally has no declaration file.
import {
  assertMacNativeInventory,
  assertMacSignaturePolicy,
  assertDiskImageContainsApp,
  collectMacPackageFiles,
  inspectMacCodeSignature,
} from "../scripts/audit-macos-package.mjs"
import { fileSymlinksSupported } from "./helpers/symlink-capability"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("macOS package security report", () => {
  it("wires Preview audit and one-command evidence entrypoints", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
    expect(packageJson.scripts["package:audit:preview:mac"]).toContain("darwin-arm64")
    expect(packageJson.scripts["package:smoke:lifecycle:preview:mac"]).toContain(
      "smoke-macos-package-lifecycle.mjs",
    )
    expect(packageJson.scripts["verify:mac:local"]).toContain("verify-macos-local.mjs")

    const lifecycle = readFileSync("scripts/smoke-macos-package-lifecycle.mjs", "utf8")
    expect(lifecycle).toContain("mkdtempSync")
    expect(lifecycle).not.toContain('path.join("/Applications"')

    const workflow = readFileSync(".github/workflows/release-macos.yml", "utf8")
    expect(workflow).toContain("audit-macos-package.mjs")
    expect(workflow).toContain("macos-security-${{ matrix.arch }}.json.sha256")
  })

  it.runIf(fileSymlinksSupported)("accepts only internal relative bundle symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-mac-audit-"))
    roots.push(root)
    const app = join(root, "Flapstack Preview.app")
    const versions = join(app, "Contents", "Frameworks", "Example.framework", "Versions")
    mkdirSync(join(versions, "A"), { recursive: true })
    writeFileSync(join(versions, "A", "Example"), "binary")
    symlinkSync("A", join(versions, "Current"), "dir")

    await expect(collectMacPackageFiles(app)).resolves.toContainEqual(
      expect.objectContaining({
        path: "Contents/Frameworks/Example.framework/Versions/Current",
        kind: "symlink",
        target: "A",
      }),
    )

    const outside = join(root, "outside")
    writeFileSync(outside, "outside")
    symlinkSync("../../../../../../outside", join(versions, "escape"), "file")
    await expect(collectMacPackageFiles(app)).rejects.toThrow(/escapes the app bundle/)
  })

  it("requires every inventoried Mach-O to include the target architecture", () => {
    expect(() =>
      assertMacNativeInventory(
        [
          { path: "Contents/MacOS/Flapstack", format: "mach-o", architectures: ["arm64"] },
          {
            path: "Contents/Resources/native.node",
            format: "mach-o-fat",
            architectures: ["arm64", "x64"],
          },
        ],
        "arm64",
      ),
    ).not.toThrow()
    expect(() =>
      assertMacNativeInventory(
        [{ path: "Contents/MacOS/Flapstack", format: "mach-o", architectures: ["x64"] }],
        "arm64",
      ),
    ).toThrow(/must include macOS arm64/)
  })

  it("binds a disk image audit to the app contained in that image", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-mac-dmg-audit-"))
    roots.push(root)
    const app = join(root, "Flapstack.app")
    const artifact = join(root, "Flapstack.dmg")
    mkdirSync(join(app, "Contents"), { recursive: true })
    writeFileSync(join(app, "Contents", "payload"), "expected")
    writeFileSync(artifact, "disk image fixture")
    const manifest = await collectMacPackageFiles(app)

    const runner = (_command: string, args: string[]) => {
      if (args[0] === "attach") {
        expect(args).toContain("-readonly")
        const mountPath = args[args.indexOf("-mountpoint") + 1]!
        cpSync(app, join(mountPath, "Flapstack.app"), { recursive: true })
      }
      return { status: 0, stdout: "", stderr: "" }
    }
    await expect(
      assertDiskImageContainsApp({
        artifactPath: artifact,
        expectedAppPath: app,
        expectedManifest: manifest,
        spawn: runner,
      }),
    ).resolves.toMatchObject({ app: "Flapstack.app" })

    const tamperedRunner = (_command: string, args: string[]) => {
      if (args[0] === "attach") {
        const mountPath = args[args.indexOf("-mountpoint") + 1]!
        cpSync(app, join(mountPath, "Flapstack.app"), { recursive: true })
        writeFileSync(join(mountPath, "Flapstack.app", "Contents", "payload"), "tampered")
      }
      return { status: 0, stdout: "", stderr: "" }
    }
    await expect(
      assertDiskImageContainsApp({
        artifactPath: artifact,
        expectedAppPath: app,
        expectedManifest: manifest,
        spawn: tamperedRunner,
      }),
    ).rejects.toThrow(/does not match/)

    const modeRunner = (_command: string, args: string[]) => {
      if (args[0] === "attach") {
        const mountPath = args[args.indexOf("-mountpoint") + 1]!
        cpSync(app, join(mountPath, "Flapstack.app"), { recursive: true })
        chmodSync(join(mountPath, "Flapstack.app", "Contents", "payload"), 0o755)
      }
      return { status: 0, stdout: "", stderr: "" }
    }
    await expect(
      assertDiskImageContainsApp({
        artifactPath: artifact,
        expectedAppPath: app,
        expectedManifest: manifest,
        spawn: modeRunner,
      }),
    ).rejects.toThrow(/does not match/)

    let retainedMountPath = ""
    const detachFailureRunner = (_command: string, args: string[]) => {
      if (args[0] === "attach") {
        retainedMountPath = args[args.indexOf("-mountpoint") + 1]!
        cpSync(app, join(retainedMountPath, "Flapstack.app"), { recursive: true })
        return { status: 0, stdout: "", stderr: "" }
      }
      return { status: 1, stdout: "", stderr: "busy" }
    }
    await expect(
      assertDiskImageContainsApp({
        artifactPath: artifact,
        expectedAppPath: app,
        expectedManifest: manifest,
        spawn: detachFailureRunner,
      }),
    ).rejects.toThrow(/mount retained at/)
    expect(existsSync(retainedMountPath)).toBe(true)
    rmSync(retainedMountPath, { recursive: true, force: true })
  })

  it("allows the documented unsigned beta but fails a signed release closed", () => {
    const unsigned = {
      status: "unsigned",
      verified: false,
      authorities: [],
      entitlements: null,
    }
    expect(() => assertMacSignaturePolicy(unsigned)).not.toThrow()
    expect(() => assertMacSignaturePolicy(unsigned, { requireSigned: true })).toThrow(
      /signed macOS package is required/i,
    )
    expect(() =>
      assertMacSignaturePolicy(
        {
          status: "signed",
          verified: true,
          runtime: true,
          teamIdentifier: "TEAM123",
          authorities: ["Developer ID Application: Flapstack (TEAM123)"],
          entitlements: { "com.apple.security.network.client": true },
        },
        {
          requireSigned: true,
          expectedEntitlements: {
            "com.apple.security.network.client": true,
            "com.apple.security.device.audio-input": true,
          },
        },
      ),
    ).toThrow(/audio-input/)
    expect(() =>
      assertMacSignaturePolicy(
        {
          status: "signed",
          verified: true,
          runtime: false,
          teamIdentifier: "TEAM123",
          authorities: ["Developer ID Application: Flapstack (TEAM123)"],
          entitlements: { "com.apple.security.network.client": true },
        },
        {
          requireSigned: true,
          expectedEntitlements: { "com.apple.security.network.client": true },
        },
      ),
    ).toThrow(/hardened runtime/)
    expect(() =>
      assertMacSignaturePolicy(
        {
          status: "signed",
          verified: true,
          runtime: true,
          teamIdentifier: "TEAM123",
          authorities: ["Developer ID Application: Flapstack (TEAM123)"],
          entitlements: {
            "com.apple.security.network.client": true,
            "com.apple.security.get-task-allow": true,
          },
        },
        {
          requireSigned: true,
          expectedEntitlements: { "com.apple.security.network.client": true },
        },
      ),
    ).toThrow(/undeclared entitlement/)
  })

  it("reports linker ad-hoc signatures as beta-only even when strict verification fails", () => {
    const calls: string[][] = []
    const runner = (_command: string, args: string[]) => {
      calls.push(args)
      if (args.includes("-dv")) {
        return {
          status: 0,
          stdout: "",
          stderr:
            "Identifier=Electron\nCodeDirectory flags=0x20002(adhoc,linker-signed)\nSignature=adhoc\nTeamIdentifier=not set\n",
        }
      }
      return { status: 1, stdout: "", stderr: "code has no resources" }
    }
    const signature = inspectMacCodeSignature("/tmp/Flapstack Preview.app", runner)

    expect(signature).toMatchObject({
      status: "ad-hoc",
      verified: false,
      verificationError: "code has no resources",
      authorities: [],
    })
    expect(calls).toHaveLength(2)
    expect(() => assertMacSignaturePolicy(signature)).not.toThrow()
    expect(() => assertMacSignaturePolicy(signature, { requireSigned: true })).toThrow(
      /signed macOS package is required/i,
    )
  })
})
