#!/usr/bin/env node

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createReadStream } from "node:fs"
import fs from "node:fs"
import { lstat, readlink, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertPackageProvenance,
  assertReleaseSourceState,
  findSecretFindings,
  summarizeDependencyLicenses,
} from "./audit-windows-package.mjs"
import { inspectMacApp } from "./inspect-packaged-binaries.mjs"
import { inspectBinaryArchitecture, sha256File } from "./lib/packaged-binary.mjs"
import { readPackageSourceState } from "./lib/package-provenance.mjs"

const require = createRequire(import.meta.url)
const asar = require("@electron/asar")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SECRET_SCAN_OVERLAP_BYTES = 64 * 1024
const BUILD_OUTPUT_EXTENSIONS = new Set([
  ".dSYM",
  ".exp",
  ".iobj",
  ".ilk",
  ".ipdb",
  ".lib",
  ".obj",
  ".pdb",
])
const AUTOMATIC_SIGNING_ENTITLEMENTS = new Set([
  "com.apple.application-identifier",
  "com.apple.developer.team-identifier",
  "keychain-access-groups",
])

function relativePath(base, file) {
  return path.relative(base, file).split(path.sep).join("/")
}

function inside(base, candidate) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`)
}

function packagedPath(relative) {
  const prefix = "Contents/Resources/"
  return relative.startsWith(prefix) ? `resources/${relative.slice(prefix.length)}` : relative
}

export async function collectMacPackageFiles(appPath) {
  const base = path.resolve(appPath)
  const rootStat = await lstat(base)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || path.extname(base) !== ".app") {
    throw new Error("Audited macOS app must be a real .app directory")
  }
  const entries = []
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const absolute = path.join(directory, child.name)
      const displayPath = relativePath(base, absolute)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        const target = await readlink(absolute)
        if (path.isAbsolute(target)) {
          throw new Error(`${displayPath}: package symlink must be relative`)
        }
        const resolvedTarget = path.resolve(path.dirname(absolute), target)
        if (!inside(base, resolvedTarget)) {
          throw new Error(`${displayPath}: package symlink escapes the app bundle`)
        }
        await lstat(resolvedTarget)
        entries.push({
          path: displayPath,
          kind: "symlink",
          target,
          bytes: Buffer.byteLength(target),
          sha256: createHash("sha256").update(`symlink\0${target}`).digest("hex"),
        })
        continue
      }
      if (stat.isDirectory()) {
        if (BUILD_OUTPUT_EXTENSIONS.has(path.extname(child.name))) {
          throw new Error(`${displayPath}: native build output must not be distributed`)
        }
        await visit(absolute)
        continue
      }
      if (!stat.isFile()) {
        throw new Error(`${displayPath}: package entry is not a regular file or safe symlink`)
      }
      const extension = path.extname(child.name)
      if (BUILD_OUTPUT_EXTENSIONS.has(extension)) {
        throw new Error(`${displayPath}: native build output must not be distributed`)
      }
      entries.push({
        path: displayPath,
        kind: "file",
        bytes: stat.size,
        mode: stat.mode & 0o777,
        sha256: await sha256File(absolute),
      })
    }
  }
  await visit(base)
  return entries
}

async function scanFileForSecrets(filePath, displayPath) {
  let overlap = Buffer.alloc(0)
  const findings = []
  const seen = new Set()
  for await (const rawChunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const chunk = Buffer.concat([overlap, rawChunk])
    for (const finding of findSecretFindings(displayPath, chunk)) {
      const key = `${finding.kind}:${finding.fingerprint}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push(finding)
    }
    overlap = chunk.subarray(Math.max(0, chunk.length - SECRET_SCAN_OVERLAP_BYTES))
  }
  return findings
}

export async function scanMacPackageText(appPath, manifest) {
  const findings = []
  const includedPaths = new Set()
  const includedFileHashes = new Map()
  let externalFiles = 0
  let externalBytes = 0
  for (const item of manifest) {
    if (item.kind !== "file") continue
    const normalized = packagedPath(item.path)
    includedPaths.add(normalized)
    includedFileHashes.set(normalized, item.sha256)
    externalFiles += 1
    externalBytes += item.bytes
    if (item.path === "Contents/Resources/app.asar") continue
    findings.push(
      ...(await scanFileForSecrets(path.join(appPath, ...item.path.split("/")), normalized)),
    )
  }

  const asarPath = path.join(appPath, "Contents", "Resources", "app.asar")
  let asarFiles = 0
  let asarBytes = 0
  for (const rawEntry of asar.listPackage(asarPath).sort()) {
    const entry = rawEntry.replace(/^[/\\]+/, "")
    const stat = asar.statFile(asarPath, entry)
    if (stat.files || stat.link) continue
    const buffer = asar.extractFile(asarPath, entry)
    const displayPath = `resources/app.asar/${entry.replaceAll("\\", "/")}`
    includedPaths.add(displayPath)
    includedFileHashes.set(displayPath, createHash("sha256").update(buffer).digest("hex"))
    asarFiles += 1
    asarBytes += buffer.length
    findings.push(...findSecretFindings(displayPath, buffer))
  }
  return {
    findings,
    includedPaths,
    includedFileHashes,
    coverage: { externalFiles, externalBytes, asarFiles, asarBytes, skippedFiles: 0 },
  }
}

export function assertMacNativeInventory(entries, expectedArchitecture) {
  if (!new Set(["arm64", "x64"]).has(expectedArchitecture)) {
    throw new Error(`Unsupported macOS architecture: ${expectedArchitecture}`)
  }
  for (const entry of entries) {
    if (
      !new Set(["mach-o", "mach-o-fat"]).has(entry.format) ||
      !entry.architectures.includes(expectedArchitecture)
    ) {
      throw new Error(
        `${entry.path}: native package file must include macOS ${expectedArchitecture}`,
      )
    }
  }
  if (entries.length === 0) throw new Error("macOS package contains no Mach-O binaries")
}

export function inspectMacNativeFiles(appPath, manifest, expectedArchitecture) {
  const entries = []
  for (const item of manifest) {
    if (item.kind !== "file") continue
    const filePath = path.join(appPath, ...item.path.split("/"))
    const inspection = inspectBinaryArchitecture(filePath)
    const extension = path.extname(item.path).toLowerCase()
    const isMachO = new Set(["mach-o", "mach-o-fat"]).has(inspection.format)
    if (extension === ".node" && !isMachO) {
      throw new Error(`${item.path}: native Node module must be Mach-O`)
    }
    if (!isMachO) continue
    entries.push({
      path: item.path,
      bytes: item.bytes,
      sha256: item.sha256,
      mode: item.mode,
      ...inspection,
    })
  }
  assertMacNativeInventory(entries, expectedArchitecture)
  return entries
}

function commandOutput(result) {
  return `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim()
}

function plistJson(plistPath, runner = spawnSync) {
  const result = runner("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath], {
    encoding: "utf8",
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not read plist ${plistPath}: ${result.error?.message || commandOutput(result)}`,
    )
  }
  return JSON.parse(String(result.stdout))
}

function plistBytesJson(bytes, runner = spawnSync) {
  const result = runner("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", "-"], {
    encoding: "utf8",
    input: bytes,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not parse signed entitlements: ${result.error?.message || commandOutput(result)}`,
    )
  }
  return JSON.parse(String(result.stdout))
}

export function inspectMacCodeSignature(appPath, runner = spawnSync) {
  const detail = runner("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  })
  const detailOutput = commandOutput(detail)
  if (detail.error) throw detail.error
  if (detail.status !== 0) {
    if (/not signed at all/i.test(detailOutput)) {
      return { status: "unsigned", verified: false, authorities: [], entitlements: null }
    }
    throw new Error(`Could not inspect macOS signature: ${detailOutput}`)
  }

  const values = (name) =>
    [...detailOutput.matchAll(new RegExp(`^${name}=(.+)$`, "gm"))].map((match) => match[1].trim())

  const verify = runner(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    {
      encoding: "utf8",
    },
  )
  const verifyOutput = commandOutput(verify)
  if (/^Signature=adhoc$/im.test(detailOutput) || /flags=.*\badhoc\b/i.test(detailOutput)) {
    return {
      status: "ad-hoc",
      verified: !verify.error && verify.status === 0,
      verificationError:
        verify.error?.message ||
        (verify.status === 0 ? null : verifyOutput || "verification failed"),
      identifier: values("Identifier")[0] ?? null,
      teamIdentifier: null,
      authorities: [],
      runtime: /flags=.*\bruntime\b/i.test(detailOutput),
      entitlements: null,
    }
  }
  if (verify.error || verify.status !== 0) {
    throw new Error(
      `macOS package signature verification failed: ${verify.error?.message || verifyOutput}`,
    )
  }
  const entitlementResult = runner("/usr/bin/codesign", ["-d", "--entitlements", ":-", appPath], {
    encoding: "utf8",
  })
  if (entitlementResult.error || entitlementResult.status !== 0) {
    throw new Error(
      `Could not read signed entitlements: ${entitlementResult.error?.message || commandOutput(entitlementResult)}`,
    )
  }
  const entitlementOutput = commandOutput(entitlementResult)
  const plistStart = entitlementOutput.indexOf("<?xml")
  const entitlements =
    plistStart >= 0 ? plistBytesJson(entitlementOutput.slice(plistStart), runner) : {}
  return {
    status: "signed",
    verified: true,
    identifier: values("Identifier")[0] ?? null,
    teamIdentifier: values("TeamIdentifier")[0] ?? null,
    authorities: values("Authority"),
    runtime: /flags=.*\bruntime\b/i.test(detailOutput),
    entitlements,
  }
}

export function assertMacSignaturePolicy(signature, options = {}) {
  if (signature.status === "signed" && signature.verified !== true) {
    throw new Error("Signed macOS package did not pass strict verification")
  }
  if (options.requireSigned && signature.status !== "signed") {
    throw new Error("Signed macOS package is required for this audit")
  }
  if (options.requireSigned) {
    if (signature.runtime !== true) {
      throw new Error("Signed macOS package must enable the hardened runtime")
    }
    if (!signature.teamIdentifier) {
      throw new Error("Signed macOS package is missing its Developer ID team identifier")
    }
    if (
      !signature.authorities?.some((authority) => /^Developer ID Application:/i.test(authority))
    ) {
      throw new Error("Signed macOS package is not signed by a Developer ID Application identity")
    }
    for (const [key, value] of Object.entries(options.expectedEntitlements ?? {})) {
      if (signature.entitlements?.[key] !== value) {
        throw new Error(`Signed macOS package is missing expected entitlement: ${key}`)
      }
    }
    for (const key of Object.keys(signature.entitlements ?? {})) {
      if (
        !(key in (options.expectedEntitlements ?? {})) &&
        !AUTOMATIC_SIGNING_ENTITLEMENTS.has(key)
      ) {
        throw new Error(`Signed macOS package has an undeclared entitlement: ${key}`)
      }
    }
  }
}

function manifestDigest(entries) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        entries.map(({ path: entryPath, kind, target, bytes, mode, sha256 }) => ({
          path: entryPath,
          kind,
          ...(target ? { target } : {}),
          bytes,
          ...(mode === undefined ? {} : { mode }),
          sha256,
        })),
      ),
    )
    .digest("hex")
}

export async function assertDiskImageContainsApp(options) {
  const artifactPath = path.resolve(options.artifactPath)
  const expectedAppPath = path.resolve(options.expectedAppPath)
  const expectedManifest = options.expectedManifest
  const runner = options.spawn ?? spawnSync
  const mountPath = fs.mkdtempSync(path.join(tmpdir(), "flapstack-dmg-audit-"))
  let attached = false
  let detachFailed = false
  let result = null
  let failure = null
  try {
    const attach = runner(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPath, artifactPath],
      { encoding: "utf8" },
    )
    if (attach.error || attach.status !== 0) {
      throw new Error(
        `Could not mount audited macOS disk image: ${attach.error?.message || commandOutput(attach)}`,
      )
    }
    attached = true
    const expectedName = path.basename(expectedAppPath)
    const apps = fs
      .readdirSync(mountPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && path.extname(entry.name) === ".app")
    if (apps.length !== 1 || apps[0].name !== expectedName) {
      throw new Error(`Audited macOS disk image must contain exactly ${expectedName}`)
    }
    const containedManifest = await collectMacPackageFiles(path.join(mountPath, expectedName))
    const expectedDigest = manifestDigest(expectedManifest)
    const containedDigest = manifestDigest(containedManifest)
    if (containedDigest !== expectedDigest) {
      throw new Error("Audited macOS disk image app does not match the audited app directory")
    }
    result = { app: expectedName, manifestSha256: containedDigest }
  } catch (error) {
    failure = error
  } finally {
    if (attached) {
      const detach = runner("/usr/bin/hdiutil", ["detach", mountPath], { encoding: "utf8" })
      if (detach.error || detach.status !== 0) {
        detachFailed = true
        failure = new Error(
          `Could not detach audited macOS disk image; mount retained at ${mountPath}: ${detach.error?.message || commandOutput(detach)}`,
        )
      }
    }
    if (!detachFailed) fs.rmSync(mountPath, { recursive: true, force: true })
  }
  if (failure) throw failure
  return result
}

function parseArg(args, name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export async function auditMacPackage(options) {
  const appPath = path.resolve(options.appPath)
  const outputPath = path.resolve(options.outputPath)
  const channel = options.channel ?? "preview"
  const platform = options.platform
  if (!/^darwin-(arm64|x64)$/.test(platform)) {
    throw new Error("macOS package audit requires darwin-arm64 or darwin-x64")
  }
  if (!new Set(["preview", "release"]).has(channel)) {
    throw new Error("macOS package audit channel must be preview or release")
  }
  const architecture = platform.slice("darwin-".length)
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const expectedProductName =
    channel === "preview" ? "Flapstack Preview" : packageJson.build.productName
  if (path.basename(appPath) !== `${expectedProductName}.app`) {
    throw new Error(`Audited macOS app must be ${expectedProductName}.app`)
  }

  const manifest = await collectMacPackageFiles(appPath)
  const source = readPackageSourceState(root)
  if (channel === "release") assertReleaseSourceState(source)
  const info = plistJson(path.join(appPath, "Contents", "Info.plist"))
  if (
    info.CFBundleName !== expectedProductName ||
    info.CFBundleShortVersionString !== packageJson.version ||
    !info.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash ||
    !info.NSMicrophoneUsageDescription
  ) {
    throw new Error("macOS package Info.plist does not match the expected product contract")
  }

  const core = inspectMacApp(appPath, platform)
  const nativeInventory = inspectMacNativeFiles(appPath, manifest, architecture)
  const provenancePath = path.join(appPath, "Contents", "Resources", "package-provenance.json")
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"))
  assertPackageProvenance(provenance, {
    source,
    version: packageJson.version,
    productName: expectedProductName,
    channel,
    platform: "darwin",
    architecture,
  })
  const provenanceSha256 = await sha256File(provenancePath)
  const secretScan = await scanMacPackageText(appPath, manifest)
  if (secretScan.findings.length > 0) {
    throw new Error(
      `Package secret scan found ${secretScan.findings.length} potential credential(s): ${secretScan.findings
        .map((finding) => `${finding.path} (${finding.kind})`)
        .join(", ")}`,
    )
  }
  const licenseManifest = JSON.parse(
    fs.readFileSync(
      path.join(appPath, "Contents", "Resources", "dependency-licenses", "manifest.json"),
      "utf8",
    ),
  )
  const dependencies = summarizeDependencyLicenses(
    JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")),
    JSON.parse(
      fs.readFileSync(path.join(root, "build", "dependency-license-overrides.json"), "utf8"),
    ),
    {
      includedPaths: secretScan.includedPaths,
      includedFileHashes: secretScan.includedFileHashes,
      licenseManifest,
    },
  )
  const expectedEntitlements = plistJson(path.join(root, packageJson.build.mac.entitlements))
  const signature = inspectMacCodeSignature(appPath)
  assertMacSignaturePolicy(signature, {
    requireSigned: options.requireSigned === true,
    expectedEntitlements,
  })
  let artifact = null
  if (options.artifactPath) {
    const artifactPath = path.resolve(options.artifactPath)
    const artifactStat = fs.lstatSync(artifactPath)
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile()) {
      throw new Error("Audited macOS disk image must be a regular file")
    }
    const containedApp = await assertDiskImageContainsApp({
      artifactPath,
      expectedAppPath: appPath,
      expectedManifest: manifest,
    })
    artifact = {
      path: path.basename(artifactPath),
      bytes: artifactStat.size,
      sha256: await sha256File(artifactPath),
      containedApp,
    }
  }
  const report = {
    schemaVersion: 1,
    channel,
    generatedAt: new Date().toISOString(),
    source: { ...source, version: packageJson.version },
    provenance: {
      embeddedPath: "Contents/Resources/package-provenance.json",
      sha256: provenanceSha256,
      manifest: provenance,
    },
    artifact: {
      app: path.basename(appPath),
      platform,
      bundleIdentifier: info.CFBundleIdentifier,
      minimumSystemVersion: info.LSMinimumSystemVersion ?? null,
      manifestSha256: manifestDigest(manifest),
      files: manifest,
      nativeInventory,
      coreBinaries: Object.fromEntries(
        Object.entries(core.binaries).map(([label, file]) => [label, relativePath(appPath, file)]),
      ),
      diskImage: artifact,
    },
    codeSignature: {
      policy: options.requireSigned
        ? "valid-developer-id-signature-required"
        : "unsigned-or-ad-hoc-beta-allowed",
      signature,
      expectedEntitlements,
    },
    dependencies,
    secretScan: { status: "pass", findings: [], coverage: secretScan.coverage },
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`
  fs.writeFileSync(outputPath, reportBytes)
  fs.writeFileSync(
    `${outputPath}.sha256`,
    `${createHash("sha256").update(reportBytes).digest("hex")}  ${path.basename(outputPath)}\n`,
  )
  return { outputPath, report }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("macOS package security audit must run on native macOS")
  }
  const args = process.argv.slice(2)
  const appPath = parseArg(args, "--app")
  const platform = parseArg(args, "--platform")
  const channel = parseArg(args, "--channel") ?? "preview"
  const outputPath = parseArg(args, "--output")
  if (!appPath || !platform || !outputPath) {
    throw new Error(
      "Usage: --app=<App.app> --platform=darwin-arm64|darwin-x64 --channel=preview|release --output=<report.json> [--artifact=<dmg>] [--require-signed]",
    )
  }
  const result = await auditMacPackage({
    appPath,
    platform,
    channel,
    outputPath,
    artifactPath: parseArg(args, "--artifact"),
    requireSigned: args.includes("--require-signed"),
  })
  console.log(`macOS package security report: ${result.outputPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
