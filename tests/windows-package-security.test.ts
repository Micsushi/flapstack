import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript package-audit helper intentionally has no declaration file.
import {
  assertAuthenticodePolicy,
  assertMalwareScanPolicy,
  assertNativePackageInventory,
  assertNoEmbeddedPortableExecutable,
  assertNoEmbeddedPortableExecutableFile,
  assertPackageProvenance,
  assertReleaseArtifactPayloadAttribution,
  assertReleaseSourceState,
  collectPackageFiles,
  expectedReleaseArtifactNames,
  expectedWindowsPublisher,
  findSecretFindings,
  isAllowedNativePath,
  summarizeDependencyLicenses,
} from "../scripts/audit-windows-package.mjs"
// @ts-expect-error JavaScript package provenance helper intentionally has no declaration file.
import {
  createPackageProvenance,
  readPackageSourceState,
} from "../scripts/lib/package-provenance.mjs"
// @ts-expect-error JavaScript packaging helper intentionally has no declaration file.
import { prepareDependencyLicenseNotices } from "../scripts/lib/dependency-license-notices.mjs"
// @ts-expect-error JavaScript release verifier intentionally has no declaration file.
import { verifyWindowsSecurityReport } from "../scripts/verify-windows-security-report.mjs"
import { fileSymlinksSupported } from "./helpers/symlink-capability"

const requireFromTest = createRequire(import.meta.url)

describe("Windows package security report", () => {
  function pe() {
    const buffer = Buffer.alloc(256)
    buffer.write("MZ", 0, "ascii")
    buffer.writeUInt32LE(128, 0x3c)
    buffer.write("PE\0\0", 128, "ascii")
    buffer.writeUInt16LE(0x8664, 132)
    return buffer
  }

  it("excludes transactional package state from exact-source provenance", () => {
    const gitignore = readFileSync(".gitignore", "utf8")
    expect(gitignore).toContain("/.release*.package-backup/")
    expect(gitignore).toContain("/.release*.package-staging/")
    expect(gitignore).toContain("/resources/.bin-stage-*/")
  })

  it("wires explicit Preview and signed-release audit entrypoints", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
    expect(packageJson.overrides).toMatchObject({
      dompurify: "3.4.12",
      "fast-uri": "3.1.5",
      "ip-address": "10.4.0",
      sharp: "0.35.3",
      tar: "7.5.22",
    })
    expect(packageJson.scripts["package:audit:preview:win"]).toContain("--channel=preview")
    expect(packageJson.scripts["package:audit:release:win"]).toContain("--channel=release")
    expect(packageJson.scripts["package:audit:release:win"]).toContain("--malware-scan")
    expect(packageJson.scripts["package:inspect:release:win"]).toContain(
      "release/win-unpacked/Flapstack.exe",
    )
    expect(packageJson.scripts["package:smoke:release:win"]).toContain("--smoke")
    expect(requireFromTest("../electron-builder.release.win.cjs")).toMatchObject({
      forceCodeSigning: true,
      nsis: {
        artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
      },
      portable: {
        artifactName: "${productName}-Portable-${version}-${arch}.${ext}",
      },
      win: {
        signAndEditExecutable: true,
        signExts: [".exe"],
        signtoolOptions: {
          signingHashAlgorithms: ["sha256"],
          rfc3161TimeStampServer: "http://timestamp.digicert.com",
        },
      },
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: "build/generated/package-provenance.json",
      to: "package-provenance.json",
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: "build/generated/dependency-licenses",
      to: "dependency-licenses",
    })
    expect(readFileSync("scripts/package-app.mjs", "utf8")).toContain(
      "prepareNotices({ root: rootDirectory })",
    )
    expect(
      JSON.parse(readFileSync("build/windows-release-security-policy.json", "utf8")),
    ).toMatchObject({
      appPublisher: { subject: "CN=Flapstack LLC", thumbprints: [] },
      executableSigning: {
        coveredExtensions: [".exe"],
        appOwned: expect.stringContaining("pinned Flapstack publisher"),
        vendorOwned: expect.stringContaining("publisher identity"),
      },
      releaseBlockedUntilThumbprintPinned: true,
    })
  })

  it("requires distinct installer and portable artifact names in the release ledger", () => {
    expect(expectedReleaseArtifactNames("Flapstack", "0.1.0", "x64")).toEqual([
      "Flapstack-Setup-0.1.0-x64.exe",
      "Flapstack-Portable-0.1.0-x64.exe",
    ])
  })

  it("fails release artifact attribution closed without extracted payload evidence", () => {
    const artifact = {
      path: "Flapstack-Setup-0.1.0-x64.exe",
      sha256: "a".repeat(64),
    }
    expect(() => assertReleaseArtifactPayloadAttribution([artifact], "b".repeat(64))).toThrow(
      /extract/i,
    )
    expect(() =>
      assertReleaseArtifactPayloadAttribution(
        [
          {
            ...artifact,
            payloadEvidence: {
              method: "extracted-payload",
              extractor: "windows-bsdtar",
              embeddedPath: "resources/package-provenance.json",
              artifactSha256: artifact.sha256,
              provenanceSha256: "b".repeat(64),
            },
          },
        ],
        "b".repeat(64),
      ),
    ).not.toThrow()
  })

  it("populates installer and portable payload evidence from extracted packaged provenance", async () => {
    const auditModule = (await import("../scripts/audit-windows-package.mjs")) as {
      collectReleaseArtifacts?: (
        outputRoot: string,
        productName: string,
        version: string,
        provenanceSha256: string,
        options: {
          runner: (
            command: string,
            args: string[],
          ) => { status: number; stdout: Buffer; stderr: Buffer }
          tarPath: string
        },
      ) => Promise<
        Array<{
          path: string
          sha256: string
          payloadEvidence: {
            method: string
            extractor: string
            embeddedPath: string
            artifactSha256: string
            provenanceSha256: string
          }
        }>
      >
    }
    expect(auditModule.collectReleaseArtifacts).toBeTypeOf("function")
    if (!auditModule.collectReleaseArtifacts) return

    const releaseRoot = mkdtempSync(join(tmpdir(), "flapstack-release-payload-evidence-"))
    const provenanceBytes = Buffer.from('{"source":{"sha":"exact-packaged-source"}}\n')
    const provenanceSha256 = createHash("sha256").update(provenanceBytes).digest("hex")
    const names = ["Flapstack-Setup-0.1.0-x64.exe", "Flapstack-Portable-0.1.0-x64.exe"]
    try {
      for (const name of names) writeFileSync(join(releaseRoot, name), pe())
      const calls: Array<{ command: string; args: string[] }> = []
      const artifacts = await auditModule.collectReleaseArtifacts(
        releaseRoot,
        "Flapstack",
        "0.1.0",
        provenanceSha256,
        {
          tarPath: "trusted-system-tar.exe",
          runner: (command, args) => {
            calls.push({ command, args })
            return {
              status: 0,
              stdout: provenanceBytes,
              stderr: Buffer.alloc(0),
            }
          },
        },
      )

      expect(artifacts.map((artifact) => artifact.path)).toEqual(names)
      expect(calls).toEqual(
        names.map((name) => ({
          command: "trusted-system-tar.exe",
          args: ["-xOf", join(releaseRoot, name), "resources/package-provenance.json"],
        })),
      )
      for (const artifact of artifacts) {
        expect(artifact.payloadEvidence).toEqual({
          method: "extracted-payload",
          extractor: "windows-bsdtar",
          embeddedPath: "resources/package-provenance.json",
          artifactSha256: artifact.sha256,
          provenanceSha256,
        })
      }
      expect(() =>
        assertReleaseArtifactPayloadAttribution(artifacts, provenanceSha256),
      ).not.toThrow()

      await expect(
        auditModule.collectReleaseArtifacts(releaseRoot, "Flapstack", "0.1.0", provenanceSha256, {
          tarPath: "trusted-system-tar.exe",
          runner: () => ({
            status: 0,
            stdout: Buffer.from('{"source":{"sha":"different-payload"}}\n'),
            stderr: Buffer.alloc(0),
          }),
        }),
      ).rejects.toThrow(/extracted provenance.*does not match/i)

      await expect(
        auditModule.collectReleaseArtifacts(releaseRoot, "Flapstack", "0.1.0", provenanceSha256, {
          tarPath: "trusted-system-tar.exe",
          runner: (_command, args) => {
            writeFileSync(args[1]!, Buffer.concat([pe(), Buffer.from("changed")]))
            return {
              status: 0,
              stdout: provenanceBytes,
              stderr: Buffer.alloc(0),
            }
          },
        }),
      ).rejects.toThrow(/artifact changed during payload extraction/i)
    } finally {
      rmSync(releaseRoot, { recursive: true, force: true })
    }
  })

  it("loads release publisher identity only from explicit public environment policy", () => {
    expect(
      expectedWindowsPublisher(
        {
          FLAPSTACK_WINDOWS_PUBLISHER_SUBJECT: "CN=Attacker",
          FLAPSTACK_WINDOWS_PUBLISHER_THUMBPRINT: "DEADBEEF",
        },
        {
          schemaVersion: 1,
          appPublisher: {
            subject: "CN=Flapstack LLC",
            thumbprints: ["AA11BB22".repeat(5)],
          },
          releaseBlockedUntilThumbprintPinned: false,
        },
      ),
    ).toEqual({
      subject: "CN=Flapstack LLC",
      thumbprints: ["AA11BB22".repeat(5)],
    })
    expect(() =>
      expectedWindowsPublisher(
        {},
        {
          schemaVersion: 1,
          appPublisher: {
            subject: "CN=Flapstack LLC",
            thumbprints: [],
          },
          releaseBlockedUntilThumbprintPinned: false,
        },
      ),
    ).toThrow(/thumbprint/i)
    expect(() =>
      expectedWindowsPublisher(
        {},
        {
          schemaVersion: 1,
          appPublisher: {
            subject: "CN=Flapstack LLC",
            thumbprints: ["AA11BB22".repeat(5)],
          },
          releaseBlockedUntilThumbprintPinned: true,
        },
      ),
    ).toThrow(/blocked/i)
  })

  it("detects credential material without treating redacted fixtures as secrets", () => {
    expect(
      findSecretFindings(
        "resources/app/config.json",
        Buffer.from(
          [
            'token="ghp_1234567890abcdefghijklmnopqrst"',
            'apiKey="sk-proj-1234567890abcdefghijklmnop"',
            'safe="[redacted-credential]"',
          ].join("\n"),
        ),
      ),
    ).toEqual([
      expect.objectContaining({ path: "resources/app/config.json", kind: "GitHub token" }),
      expect.objectContaining({ path: "resources/app/config.json", kind: "API key" }),
    ])
  })

  it("does not suppress an otherwise valid API-key shape merely because it has no digit", () => {
    expect(
      findSecretFindings(
        "resources/config",
        Buffer.from("apiKey=sk-proj-abcdefghijklmnopqrstuvwxyz"),
      ),
    ).toEqual([expect.objectContaining({ kind: "API key" })])
    expect(
      findSecretFindings(
        "resources/grammar",
        Buffer.from("verilog-sk-prompt-output|verilog-sk-prompt-reset|verilog-sk-prompt-width"),
      ),
    ).toEqual([])
  })

  it("scans large, UTF-16/NUL, extensionless, and example-context credential content", () => {
    const large = Buffer.concat([
      Buffer.alloc(9 * 1024 * 1024, "x"),
      Buffer.from(" ghp_1234567890abcdefghijklmnopqrst"),
    ])
    expect(findSecretFindings("resources/large.bundle", large)).toHaveLength(1)

    const utf16 = Buffer.from("actual=sk-proj-1234567890abcdefghijklmnop", "utf16le")
    expect(findSecretFindings("resources/CONFIG", utf16)).toHaveLength(1)

    expect(
      findSecretFindings(
        "resources/extensionless",
        Buffer.from("example production=ghp_1234567890abcdefghijklmnopqrst"),
      ),
    ).toHaveLength(1)
  })

  it("detects AWS access IDs, encrypted PEM blocks, bearer credentials, and JWTs", () => {
    const findings = findSecretFindings(
      "resources/secrets",
      Buffer.from(
        [
          "AKIAIOSFODNN7EXAMPLE",
          "-----BEGIN ENCRYPTED PRIVATE KEY-----\nYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo0123456789ABCD\n-----END ENCRYPTED PRIVATE KEY-----",
          "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
          `AIza${"A".repeat(35)}`,
          "github_pat_11AA22BB33CC44DD55EE66_FF77GG88HH99II00JJ11KK22LL33MM44NN55",
          "glpat-abcdefghijklmnopqrst",
          "npm_abcdefghijklmnopqrstuvwxyz0123456789",
        ].join("\n"),
      ),
    )
    expect(findings.map((finding) => finding.kind)).toEqual([
      "AWS access key ID",
      "encrypted private key",
      "bearer token",
      "JWT",
      "Google API key",
      "GitHub fine-grained token",
      "GitLab token",
      "npm token",
    ])
  })

  it("detects Anthropic and OpenRouter API keys", () => {
    const findings = findSecretFindings(
      "resources/provider-credentials",
      Buffer.from(
        [
          `sk-ant-api03-${"AnthropicSecret_".repeat(4)}`,
          `sk-or-v1-${"0123456789abcdef".repeat(4)}`,
        ].join("\n"),
      ),
    )
    expect(findings.map((finding) => finding.kind)).toEqual([
      "Anthropic API key",
      "OpenRouter API key",
    ])
  })

  it("keeps the packaged Stage 4 vault fixture free of embedded key-shaped literals", () => {
    const source = readFileSync("src/main/lib/mcp-test-control/stage4-operations.ts")
    expect(findSecretFindings("stage4-operations.ts", source)).toEqual([])
  })

  it("rejects unexpected native files, build debris, and non-x64 package binaries", async () => {
    expect(
      isAllowedNativePath(
        "resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
    ).toBe(true)
    expect(isAllowedNativePath("resources/app.asar.unpacked/node_modules/vendor/claude.exe")).toBe(
      false,
    )
    expect(isAllowedNativePath("resources/elevate.exe")).toBe(true)
    expect(() =>
      assertNativePackageInventory([
        { path: "Flapstack.exe", format: "pe", architectures: ["x64"] },
        { path: "resources/bin/claude.exe", format: "pe", architectures: ["x64"] },
        { path: "resources/elevate.exe", format: "pe", architectures: ["x86"] },
        {
          path: "resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node",
          format: "pe",
          architectures: ["x64"],
        },
      ]),
    ).not.toThrow()
    expect(() =>
      assertNativePackageInventory([
        { path: "resources/unknown.exe", format: "pe", architectures: ["x64"] },
      ]),
    ).toThrow(/unexpected native/i)
    expect(() =>
      assertNativePackageInventory([
        {
          path: "resources/app.asar.unpacked/node_modules/node-pty/build/addon.pdb",
          format: "build-output",
          architectures: [],
        },
      ]),
    ).toThrow(/build output/i)
    expect(() =>
      assertNativePackageInventory([
        { path: "resources/bin/claude.exe", format: "pe", architectures: ["arm64"] },
      ]),
    ).toThrow(/x64/i)
    expect(() =>
      assertNativePackageInventory([
        { path: "resources/elevate.exe", format: "pe", architectures: ["x64"] },
      ]),
    ).toThrow(/x86/i)
    expect(() =>
      assertNativePackageInventory([
        { path: "resources/bin/claude.exe", format: "pe", architectures: ["x86"] },
      ]),
    ).toThrow(/x64/i)
    expect(() =>
      assertNativePackageInventory([
        { path: "resources/renamed-payload.bin", format: "pe", architectures: ["x64"] },
      ]),
    ).toThrow(/unexpected native/i)
    expect(() =>
      assertNoEmbeddedPortableExecutable("resources/app.asar/renamed.data", pe()),
    ).toThrow(/embedded PE/i)
    expect(() =>
      assertNoEmbeddedPortableExecutable(
        "resources/app.asar/prefixed.data",
        Buffer.concat([Buffer.from("prefix-data"), pe()]),
      ),
    ).toThrow(/embedded PE/i)
    const externalRoot = mkdtempSync(join(tmpdir(), "flapstack-prefixed-pe-"))
    const externalPath = join(externalRoot, "payload.data")
    writeFileSync(externalPath, Buffer.concat([Buffer.from("prefix-data"), pe()]))
    await expect(
      assertNoEmbeddedPortableExecutableFile(externalPath, "resources/payload.data"),
    ).rejects.toThrow(/embedded PE/i)
  })

  it("allows an explicitly unsigned Preview but requires valid timestamped release signatures", () => {
    expect(() =>
      assertAuthenticodePolicy(
        [
          { path: "Flapstack Preview.exe", status: "NotSigned", timestamped: false },
          { path: "resources/bin/codex.exe", status: "NotSigned", timestamped: false },
        ],
        "preview",
      ),
    ).not.toThrow()
    expect(() =>
      assertAuthenticodePolicy(
        [
          {
            path: "Flapstack.exe",
            status: "Valid",
            timestamped: true,
            subject: "CN=Flapstack LLC",
            thumbprint: "AA11",
            signaturePolicy: "flapstack-publisher-required",
          },
          {
            path: "resources/app.asar.unpacked/node_modules/vendor/addon.node",
            status: "NotSigned",
            timestamped: false,
            subject: "",
            thumbprint: "",
            signaturePolicy: "inventory-recorded",
          },
        ],
        "release",
        { subject: "CN=Flapstack LLC", thumbprint: "AA11" },
      ),
    ).not.toThrow()

    expect(() =>
      assertAuthenticodePolicy(
        [{ path: "Flapstack.exe", status: "Valid", timestamped: false }],
        "release",
      ),
    ).toThrow(/timestamp/i)
    expect(() =>
      assertAuthenticodePolicy(
        [{ path: "Flapstack.exe", status: "NotSigned", timestamped: false }],
        "release",
      ),
    ).toThrow(/NotSigned/)
    expect(() =>
      assertAuthenticodePolicy(
        [
          {
            path: "Flapstack.exe",
            status: "Valid",
            timestamped: true,
            subject: "CN=Flapstack LLC",
            thumbprint: "AA11",
          },
        ],
        "release",
        { subject: "CN=Flapstack LLC", thumbprint: "AA11" },
      ),
    ).not.toThrow()
    expect(() =>
      assertAuthenticodePolicy(
        [
          {
            path: "Flapstack.exe",
            status: "Valid",
            timestamped: true,
            subject: "CN=Other Publisher",
            thumbprint: "BB22",
          },
        ],
        "release",
        { subject: "CN=Flapstack LLC", thumbprint: "AA11" },
      ),
    ).toThrow(/publisher/i)
    expect(() =>
      assertAuthenticodePolicy(
        [
          {
            path: "resources/bin/codex.exe",
            status: "NotSigned",
            timestamped: false,
            signaturePolicy: "vendor-publisher-required",
          },
        ],
        "release",
        { subject: "CN=Flapstack LLC", thumbprints: ["AA11"] },
      ),
    ).toThrow(/NotSigned/)
    expect(() =>
      assertAuthenticodePolicy(
        [
          {
            path: "resources/bin/codex.exe",
            status: "Valid",
            timestamped: true,
            subject: "CN=Microsoft Corporation",
            thumbprint: "BB22",
            signaturePolicy: "vendor-publisher-required",
          },
        ],
        "release",
        { subject: "CN=Flapstack LLC", thumbprints: ["AA11"] },
      ),
    ).not.toThrow()
  })

  it("requires completed clean malware evidence for a release, not for an unsigned Preview", () => {
    expect(() => assertMalwareScanPolicy({ status: "not-run" }, "preview")).not.toThrow()
    expect(() => assertMalwareScanPolicy({ status: "not-run" }, "release")).toThrow(/malware/i)
    expect(() =>
      assertMalwareScanPolicy(
        { status: "pass", activeThreats: 0, detectionsDuringScan: 1 },
        "release",
      ),
    ).toThrow(/detection/i)
    expect(() =>
      assertMalwareScanPolicy(
        { status: "pass", activeThreats: 1, detectionsDuringScan: 0 },
        "release",
      ),
    ).toThrow(/threat/i)
    expect(() =>
      assertMalwareScanPolicy(
        {
          status: "pass",
          activeThreats: 0,
          detectionsDuringScan: 0,
          runningMode: "Normal",
          realTimeProtectionEnabled: true,
          signatureUpdatedAt: "2026-07-25T12:00:00.000Z",
          scanTarget: "C:\\release",
          scanTargetSha256: "a".repeat(64),
        },
        "release",
        {
          now: new Date("2026-07-25T13:00:00.000Z"),
          scanTarget: "C:\\release",
          scanTargetSha256: "a".repeat(64),
        },
      ),
    ).not.toThrow()
    expect(() =>
      assertMalwareScanPolicy(
        {
          status: "pass",
          activeThreats: 0,
          detectionsDuringScan: 0,
          runningMode: "Passive",
          realTimeProtectionEnabled: false,
          signatureUpdatedAt: "2026-07-20T12:00:00.000Z",
          scanTarget: "C:\\other",
          scanTargetSha256: "b".repeat(64),
        },
        "release",
        {
          now: new Date("2026-07-25T13:00:00.000Z"),
          scanTarget: "C:\\release",
          scanTargetSha256: "a".repeat(64),
        },
      ),
    ).toThrow(/running mode|real-time|signature|target/i)
  })

  it("cryptographically binds package provenance to exact source and version", () => {
    const source = {
      sha: "a".repeat(40),
      tree: "b".repeat(40),
      fingerprint: "c".repeat(64),
      clean: true,
    }
    const provenance = createPackageProvenance({
      source,
      version: "0.1.0",
      productName: "Flapstack",
      channel: "release",
      platform: "win32",
      architectures: ["x64"],
      generatedAt: "2026-07-25T12:00:00.000Z",
    })
    expect(() =>
      assertPackageProvenance(provenance, {
        source,
        version: "0.1.0",
        productName: "Flapstack",
        channel: "release",
        platform: "win32",
        architecture: "x64",
      }),
    ).not.toThrow()
    expect(() =>
      assertPackageProvenance(provenance, {
        source: { ...source, sha: "d".repeat(40) },
        version: "0.1.0",
        productName: "Flapstack",
        channel: "release",
        platform: "win32",
        architecture: "x64",
      }),
    ).toThrow(/provenance.*sha/i)
    expect(() =>
      assertPackageProvenance(provenance, {
        source,
        version: "0.2.0",
        productName: "Flapstack",
        channel: "release",
        platform: "win32",
        architecture: "x64",
      }),
    ).toThrow(/version/i)
  })

  it("fails release provenance closed on Git failure, missing SHA, or dirty source", () => {
    expect(() => assertReleaseSourceState({ sha: null, tree: null, fingerprint: null })).toThrow(
      /source/i,
    )
    expect(() =>
      assertReleaseSourceState({
        sha: "a".repeat(40),
        tree: "b".repeat(40),
        fingerprint: "c".repeat(64),
        clean: false,
      }),
    ).toThrow(/clean/i)
    expect(() =>
      readPackageSourceState(".", () => ({
        status: 1,
        stdout: "",
        stderr: "repository unavailable",
      })),
    ).toThrow(/repository unavailable/i)
  })

  it("detects assume-unchanged, skip-worktree, staged-index, and untracked source deception", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-exact-source-"))
    writeFileSync(join(root, "tracked.txt"), "tampered worktree")
    const original = Buffer.from("original worktree")
    const originalBlob = createHash("sha1")
      .update(`blob ${original.length}\0`)
      .update(original)
      .digest("hex")
    const changedIndexBlob = "d".repeat(40)
    const result = (
      indexBlob: string,
      headBlob: string,
      untracked = "",
      flags = "H tracked.txt\0",
    ) =>
      readPackageSourceState(root, (_command: string, args: string[]) => {
        const key = args.join(" ")
        const stdout =
          key === "rev-parse --verify HEAD"
            ? `${"a".repeat(40)}\n`
            : key === "rev-parse --verify HEAD^{tree}"
              ? `${"b".repeat(40)}\n`
              : key === "ls-files -s -z"
                ? `100644 ${indexBlob} 0\ttracked.txt\0`
                : key === "ls-tree -r -z --full-tree HEAD"
                  ? `100644 blob ${headBlob}\ttracked.txt\0`
                  : key === "ls-files --others --exclude-standard -z"
                    ? untracked
                    : key === "ls-files -v -z"
                      ? flags
                      : key === "ls-files -co --exclude-standard -z"
                        ? "tracked.txt\0"
                        : ""
        return { status: 0, stdout, stderr: "" }
      })

    expect(result(originalBlob, originalBlob)).toMatchObject({
      clean: false,
      indexMatchesHead: true,
      worktreeMatchesIndex: false,
      untrackedFiles: 0,
    })
    expect(result(changedIndexBlob, originalBlob)).toMatchObject({
      clean: false,
      indexMatchesHead: false,
    })
    writeFileSync(join(root, "tracked.txt"), original)
    expect(result(originalBlob, originalBlob, "", "h tracked.txt\0")).toMatchObject({
      clean: false,
      worktreeMatchesIndex: true,
      deceptiveIndexFlags: 1,
    })
    expect(result(originalBlob, originalBlob, "", "S tracked.txt\0")).toMatchObject({
      clean: false,
      worktreeMatchesIndex: true,
      deceptiveIndexFlags: 1,
    })
    writeFileSync(join(root, "untracked.txt"), "untracked")
    expect(result(originalBlob, originalBlob, "untracked.txt\0")).toMatchObject({
      clean: false,
      untrackedFiles: 1,
    })
  })

  it("builds a deterministic regular-file manifest and rejects package symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-package-audit-"))
    mkdirSync(join(root, "resources"), { recursive: true })
    writeFileSync(join(root, "Flapstack.exe"), "app")
    writeFileSync(join(root, "resources", "app.asar"), "archive")

    await expect(collectPackageFiles(root)).resolves.toEqual([
      expect.objectContaining({
        path: "Flapstack.exe",
        bytes: 3,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        path: "resources/app.asar",
        bytes: 7,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])

    if (fileSymlinksSupported) {
      symlinkSync(join(root, "Flapstack.exe"), join(root, "linked.exe"))
      await expect(collectPackageFiles(root)).rejects.toThrow(/symbolic link/i)
    }
  })

  it("fails dependency-license inventory when a production package has no declared license", () => {
    const lock = {
      packages: {
        "": { dependencies: { licensed: "1.0.0", unlicensed: "1.0.0" } },
        "node_modules/licensed": { version: "1.0.0", license: "MIT" },
        "node_modules/unlicensed": { version: "1.0.0" },
      },
    }
    expect(() => summarizeDependencyLicenses(lock)).toThrow(/unlicensed/)
    expect(
      summarizeDependencyLicenses({
        ...lock,
        packages: {
          ...lock.packages,
          "node_modules/unlicensed": { version: "1.0.0", license: "Apache-2.0" },
        },
      }),
    ).toEqual([
      { name: "licensed", version: "1.0.0", license: "MIT" },
      { name: "unlicensed", version: "1.0.0", license: "Apache-2.0" },
    ])
  })

  it("requires SEE LICENSE IN notices to be present in the packaged payload", () => {
    const lock = {
      packages: {
        "node_modules/vendor": {
          version: "1.0.0",
          license: "SEE LICENSE IN LICENSE.md",
        },
      },
    }
    expect(() => summarizeDependencyLicenses(lock)).toThrow(/LICENSE\.md/)
    expect(
      summarizeDependencyLicenses(
        lock,
        {},
        {
          includedPaths: new Set([
            "resources/app.asar/node_modules/vendor/index.js",
            "resources/dependency-licenses/vendor/LICENSE.md",
          ]),
          includedFileHashes: new Map([
            [
              "resources/dependency-licenses/vendor/LICENSE.md",
              createHash("sha256").update("vendor terms").digest("hex"),
            ],
          ]),
          licenseManifest: {
            schemaVersion: 1,
            dependencies: [
              {
                name: "vendor",
                version: "1.0.0",
                declaredLicense: "SEE LICENSE IN LICENSE.md",
                files: [
                  {
                    path: "vendor/LICENSE.md",
                    sha256: createHash("sha256").update("vendor terms").digest("hex"),
                    sourceKind: "declared-notice",
                  },
                ],
              },
            ],
          },
        },
      ),
    ).toEqual([
      {
        name: "vendor",
        version: "1.0.0",
        license: "SEE LICENSE IN LICENSE.md",
        noticePaths: ["resources/dependency-licenses/vendor/LICENSE.md"],
      },
    ])
  })

  it("stages referenced dependency notices as explicit package resources", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-license-notices-"))
    mkdirSync(join(root, "node_modules", "vendor"), { recursive: true })
    writeFileSync(join(root, "node_modules", "vendor", "LICENSE.md"), "vendor terms")
    const outputRoot = join(root, "build", "generated", "dependency-licenses")
    const result = prepareDependencyLicenseNotices({
      root,
      outputRoot,
      overrides: {},
      textOverrides: { schemaVersion: 1, packages: {} },
      lock: {
        packages: {
          "node_modules/vendor": {
            version: "1.0.0",
            license: "SEE LICENSE IN LICENSE.md",
          },
        },
      },
    })
    expect(result).toEqual(["vendor/LICENSE.md"])
    expect(readFileSync(join(outputRoot, "vendor", "LICENSE.md"), "utf8")).toBe("vendor terms")
    expect(JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      dependencies: [
        {
          name: "vendor",
          version: "1.0.0",
          files: [
            {
              path: "vendor/LICENSE.md",
              sha256: createHash("sha256").update("vendor terms").digest("hex"),
            },
          ],
        },
      ],
    })
  })

  it("rejects arbitrary README fallback and incomplete or mismatched vetted overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-license-override-"))
    mkdirSync(join(root, "node_modules", "vendor"), { recursive: true })
    writeFileSync(join(root, "node_modules", "vendor", "README.md"), "MIT License")
    const lock = {
      packages: {
        "node_modules/vendor": {
          version: "1.0.0",
          license: "MIT",
        },
      },
    }
    const run = (override: Record<string, unknown>) =>
      prepareDependencyLicenseNotices({
        root,
        overrides: {},
        textOverrides: {
          schemaVersion: 1,
          packages: override,
        },
        lock,
      })
    expect(() => run({})).toThrow(/no distributable license text/i)
    expect(() =>
      run({
        "vendor@1.0.0": {
          declaredLicense: "Apache-2.0",
          template: "MIT",
          copyright: "Copyright (c) Vendor",
          source: "https://example.com/vendor/v1.0.0/LICENSE",
        },
      }),
    ).toThrow(/does not match the declared license/i)
    expect(() =>
      run({
        "vendor@1.0.0": {
          declaredLicense: "MIT",
          template: "MIT",
          source: "https://example.com/vendor/v1.0.0/LICENSE",
        },
      }),
    ).toThrow(/requires a copyright notice/i)
    expect(() =>
      run({
        "vendor@1.0.0": {
          declaredLicense: "MIT",
          template: "MIT",
          copyright: "Copyright (c) Vendor",
        },
      }),
    ).toThrow(/requires an HTTPS source/i)
    expect(
      run({
        "vendor@1.0.0": {
          declaredLicense: "MIT",
          template: "MIT",
          copyright: "Copyright (c) Vendor",
          source: "https://example.com/vendor/v1.0.0/LICENSE",
        },
      }),
    ).toEqual(["vendor/VETTED-LICENSE.txt"])
    const outputRoot = join(root, "build", "generated", "dependency-licenses")
    const noticePath = join(outputRoot, "vendor", "VETTED-LICENSE.txt")
    const noticeText = readFileSync(noticePath, "utf8")
    const noticeHash = createHash("sha256").update(noticeText).digest("hex")
    const manifest = JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8"))
    expect(noticeText).not.toContain("README")
    expect(
      summarizeDependencyLicenses(
        lock,
        {},
        {
          includedPaths: new Set([
            "resources/app.asar/node_modules/vendor/index.js",
            "resources/dependency-licenses/vendor/VETTED-LICENSE.txt",
          ]),
          includedFileHashes: new Map([
            ["resources/dependency-licenses/vendor/VETTED-LICENSE.txt", noticeHash],
          ]),
          licenseManifest: manifest,
        },
      ),
    ).toEqual([
      {
        name: "vendor",
        version: "1.0.0",
        license: "MIT",
        noticePaths: ["resources/dependency-licenses/vendor/VETTED-LICENSE.txt"],
      },
    ])
  })

  it("stages the checked-in LGPL and GPL terms for vetted LGPL platform packages", () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-license-lgpl-"))
    mkdirSync(join(root, "node_modules", "@img", "sharp-libvips-linux-x64"), {
      recursive: true,
    })
    const licenseTextRoot = join(root, "build", "dependency-license-texts")
    mkdirSync(licenseTextRoot, { recursive: true })
    writeFileSync(
      join(licenseTextRoot, "LGPL-3.0-or-later.txt"),
      readFileSync("build/dependency-license-texts/LGPL-3.0-or-later.txt", "utf8")
        .replaceAll("\r\n", "\n")
        .replaceAll("\n", "\r\n"),
    )
    const result = prepareDependencyLicenseNotices({
      root,
      overrides: {},
      textOverrides: {
        schemaVersion: 1,
        packages: {
          "@img/sharp-libvips-linux-x64@1.3.2": {
            declaredLicense: "LGPL-3.0-or-later",
            template: "LGPL-3.0-or-later",
            copyright: "Copyright (c) libvips and bundled library contributors",
            source: "https://github.com/lovell/sharp-libvips/blob/v1.3.2/THIRD-PARTY-NOTICES.md",
          },
        },
      },
      lock: {
        packages: {
          "node_modules/@img/sharp-libvips-linux-x64": {
            version: "1.3.2",
            license: "LGPL-3.0-or-later",
          },
        },
      },
    })
    expect(result).toEqual(["@img/sharp-libvips-linux-x64/VETTED-LICENSE.txt"])
    const notice = readFileSync(
      join(
        root,
        "build",
        "generated",
        "dependency-licenses",
        "@img",
        "sharp-libvips-linux-x64",
        "VETTED-LICENSE.txt",
      ),
      "utf8",
    )
    expect(notice).toContain("GNU LESSER GENERAL PUBLIC LICENSE")
    expect(notice).toContain("GNU GENERAL PUBLIC LICENSE")
  })

  it("covers the installed production inventory with exact package-version overrides", () => {
    const root = process.cwd()
    const outputRoot = join(
      root,
      "build",
      "generated",
      `dependency-license-inventory-test-${process.pid}`,
    )
    try {
      prepareDependencyLicenseNotices({ root, outputRoot })
      const manifest = JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8")) as {
        dependencies: Array<{
          name: string
          version: string
          files: Array<{ sourceKind: string }>
        }>
      }
      const overrideKeys = Object.keys(
        JSON.parse(readFileSync("build/dependency-license-text-overrides.json", "utf8")).packages,
      ).sort()
      const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
        packages: Record<string, { dev?: boolean; version?: string }>
      }
      const knownProductionKeys = new Set(
        Object.entries(lock.packages)
          .filter(
            ([location, dependency]) => location.startsWith("node_modules/") && !dependency.dev,
          )
          .map(
            ([location, dependency]) =>
              `${location.slice("node_modules/".length)}@${dependency.version}`,
          ),
      )
      const usedOverrideKeys = manifest.dependencies
        .filter((dependency) =>
          dependency.files.some((file) => file.sourceKind === "vetted-full-text-override"),
        )
        .map((dependency) => `${dependency.name}@${dependency.version}`)
        .sort()
      expect(overrideKeys.filter((key) => !knownProductionKeys.has(key))).toEqual([])
      expect(usedOverrideKeys.filter((key) => !overrideKeys.includes(key))).toEqual([])
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
    }
  })

  it("rehashes exact release artifacts and rejects extra release-root files before upload", async () => {
    const releaseRoot = mkdtempSync(join(tmpdir(), "flapstack-sealed-release-"))
    mkdirSync(join(releaseRoot, "win-unpacked", "resources"), { recursive: true })
    const sourceSha = "a".repeat(40)
    const provenance = createPackageProvenance({
      source: {
        sha: sourceSha,
        tree: "b".repeat(40),
        fingerprint: "c".repeat(64),
        clean: true,
      },
      version: "0.1.0",
      productName: "Flapstack",
      channel: "release",
      platform: "win32",
      architectures: ["x64"],
      generatedAt: "2026-07-25T00:00:00.000Z",
    })
    const provenancePath = join(releaseRoot, "win-unpacked", "resources", "package-provenance.json")
    const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`
    writeFileSync(provenancePath, provenanceBytes)
    const names = ["Flapstack-Setup-0.1.0-x64.exe", "Flapstack-Portable-0.1.0-x64.exe"]
    const artifacts = names.map((name) => {
      const bytes = Buffer.from(name)
      writeFileSync(join(releaseRoot, name), bytes)
      return {
        path: name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }
    })
    const packageFiles = await collectPackageFiles(join(releaseRoot, "win-unpacked"))
    const nativeInventory = names.map((name) => ({
      path: name,
      origin: "flapstack-release-artifact",
      signaturePolicy: "app-publisher-required",
    }))
    const signatures = nativeInventory.map((entry) => ({
      ...entry,
      status: "Valid",
      subject: "CN=Flapstack LLC",
      thumbprint: "d".repeat(40),
      timestamped: true,
    }))
    const reportPath = join(releaseRoot, "windows-security-report.json")
    const report = {
      schemaVersion: 2,
      channel: "release",
      source: { version: "0.1.0", sha: sourceSha },
      provenance: {
        embeddedPath: "resources/package-provenance.json",
        sha256: createHash("sha256").update(provenanceBytes).digest("hex"),
        manifest: provenance,
      },
      artifact: { files: packageFiles, releaseArtifacts: artifacts, nativeInventory },
      authenticode: { signatures },
    }
    const writeReport = () => {
      const reportBytes = `${JSON.stringify(report)}\n`
      writeFileSync(reportPath, reportBytes)
      writeFileSync(
        `${reportPath}.sha256`,
        `${createHash("sha256").update(reportBytes).digest("hex")}  windows-security-report.json\n`,
      )
    }
    const verificationOptions = {
      releaseRoot,
      reportPath,
      version: "0.1.0",
      expectedSha: sourceSha,
      expectedPublisher: {
        subject: "CN=Flapstack LLC",
        thumbprints: ["d".repeat(40)],
      },
      inspectAuthenticode: (_filePath: string, displayPath: string) => ({
        path: displayPath,
        status: "Valid",
        subject: "CN=Flapstack LLC",
        thumbprint: "d".repeat(40),
        timestamped: true,
      }),
    }
    writeReport()
    await expect(verifyWindowsSecurityReport(verificationOptions)).resolves.toMatchObject({
      artifacts: 2,
    })

    report.authenticode.signatures[0].thumbprint = "e".repeat(40)
    writeReport()
    await expect(verifyWindowsSecurityReport(verificationOptions)).rejects.toThrow(
      /fresh Authenticode evidence does not match/i,
    )
    report.authenticode.signatures[0].thumbprint = "d".repeat(40)
    writeReport()

    await expect(
      verifyWindowsSecurityReport({
        ...verificationOptions,
        inspectAuthenticode: (filePath: string, displayPath: string) => {
          if (displayPath === names[0]) writeFileSync(filePath, "changed after initial hash")
          return {
            path: displayPath,
            status: "Valid",
            subject: "CN=Flapstack LLC",
            thumbprint: "d".repeat(40),
            timestamped: true,
          }
        },
      }),
    ).rejects.toThrow(/changed during fresh signature verification/i)
    writeFileSync(join(releaseRoot, names[0]), names[0])

    writeFileSync(join(releaseRoot, "unexpected.exe"), "extra")
    await expect(verifyWindowsSecurityReport(verificationOptions)).rejects.toThrow(
      /unexpected release-root/i,
    )
  })

  it("rejects a self-consistent stale same-version security report from another source", async () => {
    const releaseRoot = mkdtempSync(join(tmpdir(), "flapstack-stale-release-"))
    mkdirSync(join(releaseRoot, "win-unpacked", "resources"), { recursive: true })
    const staleSha = "1".repeat(40)
    const expectedSha = "2".repeat(40)
    const provenance = createPackageProvenance({
      source: {
        sha: staleSha,
        tree: "3".repeat(40),
        fingerprint: "4".repeat(64),
        clean: true,
      },
      version: "0.1.0",
      productName: "Flapstack",
      channel: "release",
      platform: "win32",
      architectures: ["x64"],
      generatedAt: "2026-07-25T00:00:00.000Z",
    })
    const provenanceBytes = `${JSON.stringify(provenance)}\n`
    writeFileSync(
      join(releaseRoot, "win-unpacked", "resources", "package-provenance.json"),
      provenanceBytes,
    )
    const names = ["Flapstack-Setup-0.1.0-x64.exe", "Flapstack-Portable-0.1.0-x64.exe"]
    const artifacts = names.map((name) => {
      const bytes = Buffer.from(name)
      writeFileSync(join(releaseRoot, name), bytes)
      return {
        path: name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }
    })
    const reportPath = join(releaseRoot, "windows-security-report.json")
    const reportBytes = `${JSON.stringify({
      schemaVersion: 2,
      channel: "release",
      source: { version: "0.1.0", sha: staleSha },
      provenance: {
        embeddedPath: "resources/package-provenance.json",
        sha256: createHash("sha256").update(provenanceBytes).digest("hex"),
        manifest: provenance,
      },
      artifact: {
        files: await collectPackageFiles(join(releaseRoot, "win-unpacked")),
        releaseArtifacts: artifacts,
        nativeInventory: names.map((path) => ({ path })),
      },
      authenticode: { signatures: names.map((path) => ({ path })) },
    })}\n`
    writeFileSync(reportPath, reportBytes)
    writeFileSync(
      `${reportPath}.sha256`,
      `${createHash("sha256").update(reportBytes).digest("hex")}  windows-security-report.json\n`,
    )

    await expect(
      verifyWindowsSecurityReport({
        releaseRoot,
        reportPath,
        version: "0.1.0",
        expectedSha,
      }),
    ).rejects.toThrow(/source SHA.*release commit/i)
  })
})
