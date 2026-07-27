#!/usr/bin/env node

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { lstat, open, readdir } from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { inspectBinaryArchitecture, sha256File } from "./lib/packaged-binary.mjs"
import { packageProvenanceDigest, readPackageSourceState } from "./lib/package-provenance.mjs"

const require = createRequire(import.meta.url)
const asar = require("@electron/asar")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SECRET_SCAN_OVERLAP_BYTES = 64 * 1024
const PACKAGE_PROVENANCE_PATH = "resources/package-provenance.json"
const MAX_PACKAGE_PROVENANCE_BYTES = 256 * 1024
const SECRET_PATTERNS = [
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    kind: "API key",
    pattern: /\b(?:(?:sk|rk|pk)-proj-[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)-[A-Za-z0-9]{20,})\b/g,
  },
  {
    kind: "Anthropic API key",
    pattern: /\bsk-ant-api03-[A-Za-z0-9_-]{20,}(?=$|[^A-Za-z0-9_-])/g,
  },
  {
    kind: "OpenRouter API key",
    pattern: /\bsk-or-v1-[A-Za-z0-9_-]{20,}(?=$|[^A-Za-z0-9_-])/g,
  },
  {
    kind: "private key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}\s+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    kind: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "encrypted private key",
    pattern:
      /-----BEGIN ENCRYPTED PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}\s+-----END ENCRYPTED PRIVATE KEY-----/g,
  },
  {
    kind: "bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/g,
  },
  {
    kind: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    kind: "Google API key",
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
  },
  {
    kind: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    kind: "GitLab token",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    kind: "npm token",
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g,
  },
]
const BUILD_OUTPUT_EXTENSIONS = new Set([".exp", ".iobj", ".ilk", ".ipdb", ".lib", ".obj", ".pdb"])
const NATIVE_EXTENSIONS = new Set([".dll", ".exe", ".node"])
const FLAPSTACK_SIGNED_PATHS = [
  /^Flapstack(?: Preview)?\.exe$/,
  /^Flapstack-(?:Setup|Portable)-[0-9A-Za-z.+-]+-x64\.exe$/,
  /^resources\/bin\/flapstack-stt-sidecar\.exe$/,
]
const ALLOWED_NATIVE_PATHS = [
  /^Flapstack(?: Preview)?\.exe$/,
  /^Flapstack-(?:Setup|Portable)-[0-9A-Za-z.+-]+-x64\.exe$/,
  /^(?:d3dcompiler_47|dxcompiler|dxil|ffmpeg|libEGL|libGLESv2|vk_swiftshader|vulkan-1)\.dll$/,
  /^resources\/elevate\.exe$/,
  /^resources\/bin\/(?:claude|codex|flapstack-stt-sidecar|whisper-cli)\.exe$/,
  /^resources\/bin\/(?:ggml|ggml-base|ggml-cpu|whisper)\.dll$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/@anthropic-ai\/claude-agent-sdk-win32-x64\/claude\.exe$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/@img\/sharp-win32-x64\/lib\/(?:libvips[^/]*\.dll|sharp-win32-x64-0\.35\.3\.node)$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/@openai\/codex-win32-x64\/vendor\/x86_64-pc-windows-msvc\/.+\.exe$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/better-sqlite3\/build\/Release\/better_sqlite3\.node$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/node-pty\/bin\/win32-x64-\d+\/node-pty\.node$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/node-pty\/build\/Release\/(?:conpty|conpty_console_list|pty)\.node$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/node-pty\/build\/Release\/(?:winpty\.dll|winpty-agent\.exe)$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/onnxruntime-node\/bin\/napi-v3\/win32\/x64\/(?:DirectML|onnxruntime)\.dll$/,
  /^resources\/app\.asar\.unpacked\/node_modules\/onnxruntime-node\/bin\/napi-v3\/win32\/x64\/onnxruntime_binding\.node$/,
]

function relativePath(base, file) {
  return path.relative(base, file).split(path.sep).join("/")
}

export async function collectPackageFiles(packageRoot) {
  const base = path.resolve(packageRoot)
  const files = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        throw new Error(`${relativePath(base, absolute)}: package contains a symbolic link`)
      }
      if (stat.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!stat.isFile()) {
        throw new Error(`${relativePath(base, absolute)}: package entry is not a regular file`)
      }
      files.push({
        path: relativePath(base, absolute),
        bytes: stat.size,
        sha256: await sha256File(absolute),
      })
    }
  }
  await visit(base)
  return files
}

export function findSecretFindings(filePath, buffer) {
  const texts = [buffer.toString("utf8")]
  if (buffer.includes(0)) {
    texts.push(buffer.toString("utf16le"))
    if (buffer.length % 2 === 0) {
      const swapped = Buffer.allocUnsafe(buffer.length)
      for (let index = 0; index < buffer.length; index += 2) {
        swapped[index] = buffer[index + 1]
        swapped[index + 1] = buffer[index]
      }
      texts.push(swapped.toString("utf16le"))
    }
  }
  const findings = []
  const seen = new Set()
  for (const text of texts) {
    for (const { kind, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of text.matchAll(pattern)) {
        const value = match[0]
        const fingerprint = createHash("sha256").update(value).digest("hex").slice(0, 12)
        const key = `${kind}:${fingerprint}`
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({ path: filePath, kind, fingerprint })
      }
    }
  }
  return findings
}

export function assertNativePackageInventory(entries) {
  for (const entry of entries) {
    const extension = path.posix.extname(entry.path).toLowerCase()
    if (BUILD_OUTPUT_EXTENSIONS.has(extension) || entry.format === "build-output") {
      throw new Error(`${entry.path}: native build output must not be distributed`)
    }
    if (!NATIVE_EXTENSIONS.has(extension) && entry.format !== "pe") continue
    if (!isAllowedNativePath(entry.path)) {
      throw new Error(`${entry.path}: unexpected native package file`)
    }
    const expectedArchitecture = entry.path === "resources/elevate.exe" ? "x86" : "x64"
    if (entry.format !== "pe" || !entry.architectures.includes(expectedArchitecture)) {
      throw new Error(
        `${entry.path}: native package file must be Windows PE ${expectedArchitecture}`,
      )
    }
  }
}

export function isAllowedNativePath(filePath) {
  return ALLOWED_NATIVE_PATHS.some((pattern) => pattern.test(filePath))
}

export function assertNoEmbeddedPortableExecutable(filePath, buffer) {
  for (let mzOffset = 0; mzOffset + 64 <= buffer.length; mzOffset += 1) {
    if (buffer[mzOffset] !== 0x4d || buffer[mzOffset + 1] !== 0x5a) continue
    const peOffset = mzOffset + buffer.readUInt32LE(mzOffset + 0x3c)
    if (
      peOffset + 6 <= buffer.length &&
      buffer.toString("ascii", peOffset, peOffset + 4) === "PE\0\0"
    ) {
      throw new Error(
        `${filePath}: embedded PE payload must be unpacked, allowlisted, and inventoried`,
      )
    }
  }
}

export async function assertNoEmbeddedPortableExecutableFile(filePath, displayPath) {
  const handle = await open(filePath, "r")
  try {
    const stat = await handle.stat()
    const chunkSize = 1024 * 1024
    for (let position = 0; position < stat.size; position += chunkSize) {
      const length = Math.min(chunkSize + 1, stat.size - position)
      const chunk = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(chunk, 0, length, position)
      for (let index = 0; index + 1 < bytesRead; index += 1) {
        if (chunk[index] !== 0x4d || chunk[index + 1] !== 0x5a) continue
        const mzOffset = position + index
        const dosHeader = Buffer.alloc(64)
        const dosRead = await handle.read(dosHeader, 0, dosHeader.length, mzOffset)
        if (dosRead.bytesRead < dosHeader.length) continue
        const peOffset = mzOffset + dosHeader.readUInt32LE(0x3c)
        const peHeader = Buffer.alloc(6)
        const peRead = await handle.read(peHeader, 0, peHeader.length, peOffset)
        if (
          peRead.bytesRead === peHeader.length &&
          peHeader.toString("ascii", 0, 4) === "PE\0\0" &&
          mzOffset !== 0
        ) {
          throw new Error(
            `${displayPath}: embedded PE payload must be unpacked, allowlisted, and inventoried`,
          )
        }
      }
    }
  } finally {
    await handle.close()
  }
}

export function summarizeDependencyLicenses(lock, overrides = {}, options = {}) {
  const packages = lock?.packages
  if (!packages || typeof packages !== "object") {
    throw new Error("package-lock.json does not contain a packages inventory")
  }
  const inventory = []
  const missing = []
  const manifestEntries = new Map(
    (options.licenseManifest?.dependencies ?? []).map((entry) => [entry.name, entry]),
  )
  if (options.includedPaths && options.licenseManifest?.schemaVersion !== 1) {
    throw new Error("Packaged dependency license manifest is missing or unsupported")
  }
  for (const [location, value] of Object.entries(packages)) {
    if (!location.startsWith("node_modules/") || value.dev) continue
    const name = location.slice("node_modules/".length)
    if (options.includedPaths) {
      const prefixes = [
        `resources/app.asar/${location}/`,
        `resources/app.asar.unpacked/${location}/`,
      ]
      if (
        ![...options.includedPaths].some((included) => prefixes.some((p) => included.startsWith(p)))
      ) {
        continue
      }
    }
    const license = value.license || overrides[`${name}@${value.version}`] || overrides[name]
    if (!license) {
      missing.push(`${name}@${value.version ?? "unknown"}`)
      continue
    }
    const licenseText = String(license)
    if (!options.includedPaths && /^SEE LICENSE IN /i.test(licenseText)) {
      throw new Error(
        `${name}@${value.version ?? "unknown"} requires packaged license text: ${licenseText}`,
      )
    }
    let noticePaths
    if (options.includedPaths) {
      const manifestEntry = manifestEntries.get(name)
      if (
        !manifestEntry ||
        manifestEntry.version !== String(value.version ?? "unknown") ||
        manifestEntry.declaredLicense !== licenseText ||
        !Array.isArray(manifestEntry.files) ||
        manifestEntry.files.length === 0
      ) {
        throw new Error(`${name}@${value.version ?? "unknown"} has no exact packaged license text`)
      }
      noticePaths = manifestEntry.files.map((file) => {
        const packagedPath = `resources/dependency-licenses/${file.path}`
        if (
          !options.includedPaths.has(packagedPath) ||
          options.includedFileHashes?.get(packagedPath) !== file.sha256
        ) {
          throw new Error(`${name}: packaged license text hash does not match ${file.path}`)
        }
        return packagedPath
      })
      if (new Set(noticePaths).size !== noticePaths.length) {
        throw new Error(`${name}: packaged license manifest contains duplicate paths`)
      }
    }
    inventory.push({
      name,
      version: String(value.version ?? "unknown"),
      license: licenseText,
      ...(noticePaths ? { noticePaths } : {}),
    })
  }
  if (missing.length > 0) {
    throw new Error(`Production dependencies missing license declarations: ${missing.join(", ")}`)
  }
  return inventory.sort((left, right) => left.name.localeCompare(right.name))
}

export function expectedWindowsPublisher(
  _environment = process.env,
  policy = JSON.parse(
    fs.readFileSync(path.join(root, "build", "windows-release-security-policy.json"), "utf8"),
  ),
) {
  const subject = String(policy?.appPublisher?.subject || "").trim()
  const thumbprints = (policy?.appPublisher?.thumbprints ?? [])
    .map((value) =>
      String(value)
        .replace(/[^a-fA-F0-9]/g, "")
        .toUpperCase(),
    )
    .filter(Boolean)
  if (policy?.schemaVersion !== 1) {
    throw new Error("Checked-in release publisher policy schema is missing or unsupported")
  }
  if (policy.releaseBlockedUntilThumbprintPinned !== false) {
    throw new Error("Checked-in release publisher policy is explicitly blocked")
  }
  if (!subject) {
    throw new Error("Checked-in release publisher policy requires an app publisher subject")
  }
  if (thumbprints.length === 0) {
    throw new Error("Checked-in release publisher policy requires at least one pinned thumbprint")
  }
  if (thumbprints.some((value) => !/^[A-F0-9]{40}$/.test(value))) {
    throw new Error("Checked-in release publisher policy contains an invalid SHA-1 thumbprint")
  }
  return { subject, thumbprints }
}

export function assertAuthenticodePolicy(signatures, channel, expectedPublisher) {
  if (channel !== "preview" && channel !== "release") {
    throw new Error(`Unsupported Windows audit channel: ${channel}`)
  }
  if (channel === "preview") return
  const requiredSignatures = signatures.filter((signature) => {
    if (
      signature.signaturePolicy === "flapstack-publisher-required" ||
      signature.signaturePolicy === "app-publisher-required" ||
      signature.signaturePolicy === "vendor-publisher-required"
    ) {
      return true
    }
    return (
      signature.signaturePolicy == null &&
      FLAPSTACK_SIGNED_PATHS.some((pattern) => pattern.test(signature.path))
    )
  })
  for (const signature of requiredSignatures) {
    if (signature.status !== "Valid") {
      throw new Error(`${signature.path}: Authenticode status is ${signature.status}`)
    }
    if (!signature.timestamped) {
      throw new Error(`${signature.path}: valid Authenticode signature has no timestamp`)
    }
    const signatureSubject = String(signature.subject || "")
    const signatureThumbprint = String(signature.thumbprint || "")
      .replace(/[^a-fA-F0-9]/g, "")
      .toUpperCase()
    if (!signatureSubject || !signatureThumbprint) {
      throw new Error(`${signature.path}: Authenticode publisher identity is missing`)
    }
    const appOwned =
      signature.signaturePolicy !== "vendor-publisher-required" &&
      (signature.signaturePolicy === "flapstack-publisher-required" ||
        signature.signaturePolicy === "app-publisher-required" ||
        FLAPSTACK_SIGNED_PATHS.some((pattern) => pattern.test(signature.path)))
    if (appOwned) {
      const acceptedThumbprints =
        expectedPublisher?.thumbprints ??
        (expectedPublisher?.thumbprint ? [expectedPublisher.thumbprint] : [])
      const subjectMatches =
        !expectedPublisher?.subject ||
        signatureSubject.toLowerCase() === expectedPublisher.subject.toLowerCase()
      const thumbprintMatches =
        acceptedThumbprints.length === 0 ||
        acceptedThumbprints
          .map((value) =>
            String(value)
              .replace(/[^a-fA-F0-9]/g, "")
              .toUpperCase(),
          )
          .includes(signatureThumbprint)
      if (!subjectMatches || !thumbprintMatches) {
        throw new Error(`${signature.path}: Authenticode publisher identity does not match policy`)
      }
    }
  }
}

export function assertMalwareScanPolicy(scan, channel, expected = {}) {
  if (channel !== "release") return
  if (scan.status !== "pass") {
    throw new Error("Release package requires a completed native malware scan")
  }
  if (scan.activeThreats !== 0) {
    throw new Error(`Release package malware scan found ${scan.activeThreats} active threat(s)`)
  }
  if (scan.detectionsDuringScan !== 0) {
    throw new Error(
      `Release package malware scan recorded ${scan.detectionsDuringScan} detection(s), including remediated or quarantined threats`,
    )
  }
  if (scan.runningMode !== "Normal") {
    throw new Error(`Release Defender running mode must be Normal, found ${scan.runningMode}`)
  }
  if (scan.realTimeProtectionEnabled !== true) {
    throw new Error("Release Defender real-time protection must be enabled")
  }
  const signatureUpdatedAt = new Date(scan.signatureUpdatedAt)
  const now = expected.now ?? new Date()
  if (
    Number.isNaN(signatureUpdatedAt.getTime()) ||
    now.getTime() - signatureUpdatedAt.getTime() > 48 * 60 * 60 * 1000
  ) {
    throw new Error("Release Defender signatures must be no more than 48 hours old")
  }
  if (
    expected.scanTarget &&
    path.resolve(scan.scanTarget || "").toLowerCase() !==
      path.resolve(expected.scanTarget).toLowerCase()
  ) {
    throw new Error("Release Defender evidence does not match the exact scan target")
  }
  if (expected.scanTargetSha256 && scan.scanTargetSha256 !== expected.scanTargetSha256) {
    throw new Error("Release Defender evidence does not match the exact scan target hash")
  }
}

export function assertReleaseSourceState(source) {
  if (
    !/^[a-f0-9]{40}$/i.test(String(source?.sha || "")) ||
    !/^[a-f0-9]{40}$/i.test(String(source?.tree || "")) ||
    !/^[a-f0-9]{64}$/i.test(String(source?.fingerprint || ""))
  ) {
    throw new Error("Release audit requires complete exact source provenance")
  }
  if (source.clean !== true) {
    throw new Error("Release audit requires a clean exact-source checkout")
  }
}

export function assertPackageProvenance(provenance, expected) {
  if (provenance?.schemaVersion !== 1) {
    throw new Error("Package provenance schema is missing or unsupported")
  }
  if (
    provenance?.integrity?.algorithm !== "sha256" ||
    provenance.integrity.value !== packageProvenanceDigest(provenance)
  ) {
    throw new Error("Package provenance integrity digest does not match")
  }
  for (const field of ["sha", "tree", "fingerprint"]) {
    if (provenance.source?.[field] !== expected.source?.[field]) {
      throw new Error(`Package provenance source ${field} does not match audited source`)
    }
  }
  if (provenance.source?.clean !== expected.source?.clean) {
    throw new Error("Package provenance source cleanliness does not match audited source")
  }
  if (provenance.package?.version !== expected.version) {
    throw new Error("Package provenance version does not match audited package")
  }
  if (provenance.package?.productName !== expected.productName) {
    throw new Error("Package provenance product name does not match audited package")
  }
  if (
    provenance.build?.channel !== expected.channel ||
    provenance.build?.platform !== expected.platform ||
    !provenance.build?.architectures?.includes(expected.architecture)
  ) {
    throw new Error("Package provenance build target does not match audited package")
  }
}

export function expectedReleaseArtifactNames(productName, version, architecture = "x64") {
  return [
    `${productName}-Setup-${version}-${architecture}.exe`,
    `${productName}-Portable-${version}-${architecture}.exe`,
  ]
}

export function assertReleaseArtifactPayloadAttribution(artifacts, provenanceSha256) {
  for (const artifact of artifacts) {
    const evidence = artifact.payloadEvidence
    if (
      evidence?.method !== "extracted-payload" ||
      evidence.extractor !== "windows-bsdtar" ||
      evidence.embeddedPath !== PACKAGE_PROVENANCE_PATH ||
      evidence.artifactSha256 !== artifact.sha256 ||
      evidence.provenanceSha256 !== provenanceSha256
    ) {
      throw new Error(
        `${artifact.path}: release payload attribution requires verified extraction of the embedded provenance manifest`,
      )
    }
  }
}

function resolveWindowsTarPath(env = process.env) {
  const windowsRoot = env.SystemRoot ?? env.WINDIR
  if (!windowsRoot || !path.isAbsolute(windowsRoot)) {
    throw new Error("Release payload extraction requires an absolute Windows system root")
  }
  const tarPath = path.join(windowsRoot, "System32", "tar.exe")
  const stat = fs.lstatSync(tarPath)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Release payload extraction requires the Windows system bsdtar executable")
  }
  return tarPath
}

async function extractReleaseArtifactPayloadEvidence(artifact, provenanceSha256, options = {}) {
  const tarPath = options.tarPath ?? resolveWindowsTarPath(options.env)
  const runner = options.runner ?? spawnSync
  const result = runner(tarPath, ["-xOf", artifact.filePath, PACKAGE_PROVENANCE_PATH], {
    encoding: null,
    maxBuffer: MAX_PACKAGE_PROVENANCE_BYTES,
    windowsHide: true,
  })
  if (result.error) {
    throw new Error(`${artifact.path}: could not extract the embedded package provenance`)
  }
  if (result.signal || result.status !== 0) {
    throw new Error(`${artifact.path}: embedded package provenance extraction failed`)
  }
  const extracted = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "")
  if (extracted.length === 0 || extracted.length > MAX_PACKAGE_PROVENANCE_BYTES) {
    throw new Error(`${artifact.path}: extracted package provenance has an invalid size`)
  }
  const extractedSha256 = createHash("sha256").update(extracted).digest("hex")
  if (extractedSha256 !== provenanceSha256) {
    throw new Error(
      `${artifact.path}: extracted provenance manifest does not match the packaged provenance`,
    )
  }
  if ((await sha256File(artifact.filePath)) !== artifact.sha256) {
    throw new Error(`${artifact.path}: release artifact changed during payload extraction`)
  }
  return {
    method: "extracted-payload",
    extractor: "windows-bsdtar",
    embeddedPath: PACKAGE_PROVENANCE_PATH,
    artifactSha256: artifact.sha256,
    provenanceSha256: extractedSha256,
  }
}

export async function collectReleaseArtifacts(
  outputRoot,
  productName,
  version,
  provenanceSha256,
  options = {},
) {
  const artifacts = []
  for (const name of expectedReleaseArtifactNames(productName, version)) {
    const artifactPath = path.join(outputRoot, name)
    const stat = fs.lstatSync(artifactPath)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${name}: release artifact must be a regular file`)
    }
    const artifact = {
      path: name,
      bytes: stat.size,
      sha256: await sha256File(artifactPath),
      filePath: artifactPath,
    }
    artifact.payloadEvidence = await extractReleaseArtifactPayloadEvidence(
      artifact,
      provenanceSha256,
      options,
    )
    artifacts.push(artifact)
  }
  assertReleaseArtifactPayloadAttribution(artifacts, provenanceSha256)
  return artifacts
}

export function inspectAuthenticode(filePath, displayPath, runner = spawnSync) {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:FLAPSTACK_SIGNATURE_PATH;",
    "$result = [PSCustomObject]@{",
    "status = [string]$signature.Status;",
    "subject = [string]$signature.SignerCertificate.Subject;",
    "thumbprint = [string]$signature.SignerCertificate.Thumbprint;",
    "timestamped = $null -ne $signature.TimeStamperCertificate",
    "};",
    "$result | ConvertTo-Json -Compress",
  ].join(" ")
  const result = runner(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, FLAPSTACK_SIGNATURE_PATH: filePath },
    },
  )
  if (result.error) {
    throw new Error(`${displayPath}: could not inspect Authenticode: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `${displayPath}: Authenticode inspection failed: ${String(result.stderr ?? "").trim()}`,
    )
  }
  const parsed = JSON.parse(
    String(result.stdout ?? "")
      .replace(/^\uFEFF/, "")
      .trim(),
  )
  return {
    path: displayPath,
    status: String(parsed.status || "UnknownError"),
    subject: String(parsed.subject || ""),
    thumbprint: String(parsed.thumbprint || ""),
    timestamped: parsed.timestamped === true,
  }
}

function runWindowsDefenderScan(packageRoot, runner = spawnSync) {
  const script = [
    "$ErrorActionPreference = 'Stop';",
    "$started = Get-Date;",
    "$status = Get-MpComputerStatus;",
    "if (-not $status.AntivirusEnabled) { throw 'Microsoft Defender Antivirus is not enabled' };",
    "Start-MpScan -ScanType CustomScan -ScanPath $env:FLAPSTACK_SCAN_PATH;",
    "$active = @(Get-MpThreat | Where-Object { $_.IsActive });",
    "$detections = @(Get-MpThreatDetection | Where-Object {",
    "($_.InitialDetectionTime -ge $started) -or ($_.LastThreatStatusChangeTime -ge $started)",
    "});",
    "$result = [PSCustomObject]@{",
    "status = 'pass';",
    "activeThreats = $active.Count;",
    "detectionsDuringScan = $detections.Count;",
    "runningMode = [string]$status.AMRunningMode;",
    "realTimeProtectionEnabled = [bool]$status.RealTimeProtectionEnabled;",
    "scanTarget = [IO.Path]::GetFullPath($env:FLAPSTACK_SCAN_PATH);",
    "engineVersion = [string]$status.AMEngineVersion;",
    "signatureVersion = [string]$status.AntivirusSignatureVersion;",
    "signatureUpdatedAt = [string]$status.AntivirusSignatureLastUpdated",
    "};",
    "$result | ConvertTo-Json -Compress",
  ].join(" ")
  const result = runner(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, FLAPSTACK_SCAN_PATH: packageRoot },
    },
  )
  if (result.error) throw new Error(`Could not start Windows malware scan: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Windows malware scan failed: ${String(result.stderr ?? "").trim()}`)
  }
  const parsed = JSON.parse(
    String(result.stdout ?? "")
      .replace(/^\uFEFF/, "")
      .trim(),
  )
  return {
    status: parsed.status === "pass" ? "pass" : "failed",
    activeThreats: Number(parsed.activeThreats),
    detectionsDuringScan: Number(parsed.detectionsDuringScan),
    runningMode: String(parsed.runningMode || ""),
    realTimeProtectionEnabled: parsed.realTimeProtectionEnabled === true,
    scanTarget: String(parsed.scanTarget || ""),
    engineVersion: String(parsed.engineVersion || ""),
    signatureVersion: String(parsed.signatureVersion || ""),
    signatureUpdatedAt: String(parsed.signatureUpdatedAt || ""),
  }
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

async function scanPackageText(packageRoot) {
  const findings = []
  const packageFiles = await collectPackageFiles(packageRoot)
  const includedPaths = new Set(packageFiles.map((item) => item.path))
  const includedFileHashes = new Map(packageFiles.map((item) => [item.path, item.sha256]))
  for (const item of packageFiles) {
    if (item.path === "resources/app.asar") continue
    const filePath = path.join(packageRoot, ...item.path.split("/"))
    if (!isAllowedNativePath(item.path)) {
      await assertNoEmbeddedPortableExecutableFile(filePath, item.path)
    }
    findings.push(...(await scanFileForSecrets(filePath, item.path)))
  }
  const asarPath = path.join(packageRoot, "resources", "app.asar")
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
    if (!stat.unpacked) assertNoEmbeddedPortableExecutable(displayPath, buffer)
    asarFiles += 1
    asarBytes += buffer.length
    findings.push(...findSecretFindings(displayPath, buffer))
  }
  return {
    findings,
    includedPaths,
    includedFileHashes,
    coverage: {
      externalFiles: packageFiles.length,
      externalBytes: packageFiles.reduce((sum, item) => sum + item.bytes, 0),
      asarFiles,
      asarBytes,
      skippedFiles: 0,
    },
  }
}

function packageManifestDigest(entries) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        entries.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })),
      ),
    )
    .digest("hex")
}

function inspectNativePackageFiles(packageRoot, manifest, releaseArtifacts) {
  const entries = []
  for (const item of manifest) {
    const extension = path.posix.extname(item.path).toLowerCase()
    const filePath = path.join(packageRoot, ...item.path.split("/"))
    const inspection = BUILD_OUTPUT_EXTENSIONS.has(extension)
      ? { format: "build-output", architectures: [] }
      : inspectBinaryArchitecture(filePath)
    if (
      !BUILD_OUTPUT_EXTENSIONS.has(extension) &&
      !NATIVE_EXTENSIONS.has(extension) &&
      inspection.format !== "pe"
    ) {
      continue
    }
    const appOwned = FLAPSTACK_SIGNED_PATHS.some((pattern) => pattern.test(item.path))
    entries.push({
      path: item.path,
      filePath,
      bytes: item.bytes,
      sha256: item.sha256,
      origin: appOwned ? "flapstack" : "vendor",
      signaturePolicy: appOwned
        ? "app-publisher-required"
        : extension === ".exe"
          ? "vendor-publisher-required"
          : "inventory-recorded",
      ...inspection,
    })
  }
  for (const artifact of releaseArtifacts) {
    entries.push({
      path: artifact.path,
      filePath: artifact.filePath,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      origin: "flapstack",
      signaturePolicy: "app-publisher-required",
      ...inspectBinaryArchitecture(artifact.filePath),
    })
  }
  assertNativePackageInventory(entries)
  return entries
}

function parseArg(args, name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Windows package security audit must run on native Windows")
  }
  const args = process.argv.slice(2)
  const appArgument = parseArg(args, "--app")
  const channel = parseArg(args, "--channel") ?? "preview"
  const outputArgument = parseArg(args, "--output")
  if (!appArgument || !outputArgument) {
    throw new Error("Usage: --app=<exe> --channel=preview|release --output=<report.json>")
  }
  const appPath = path.resolve(appArgument)
  const packageRoot = path.dirname(appPath)
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const appStat = fs.lstatSync(appPath)
  if (appStat.isSymbolicLink() || !appStat.isFile()) {
    throw new Error("Audited Windows app must exist as a regular file")
  }
  const expectedProductName =
    channel === "preview" ? "Flapstack Preview" : packageJson.build.productName
  if (path.basename(appPath) !== `${expectedProductName}.exe`) {
    throw new Error(`Audited Windows app must be ${expectedProductName}.exe`)
  }
  const manifest = await collectPackageFiles(packageRoot)
  const source = readPackageSourceState(root)
  if (channel === "release") assertReleaseSourceState(source)
  const provenancePath = path.join(packageRoot, "resources", "package-provenance.json")
  const provenanceStat = fs.lstatSync(provenancePath)
  if (provenanceStat.isSymbolicLink() || !provenanceStat.isFile()) {
    throw new Error("Package provenance manifest must be an embedded regular file")
  }
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"))
  assertPackageProvenance(provenance, {
    source,
    version: packageJson.version,
    productName: expectedProductName,
    channel,
    platform: "win32",
    architecture: "x64",
  })
  const provenanceSha256 = await sha256File(provenancePath)
  const licenseOverrides = JSON.parse(
    fs.readFileSync(path.join(root, "build", "dependency-license-overrides.json"), "utf8"),
  )
  let releaseArtifacts = []
  if (channel === "release") {
    const outputRoot = path.dirname(packageRoot)
    releaseArtifacts = await collectReleaseArtifacts(
      outputRoot,
      packageJson.build.productName,
      packageJson.version,
      provenanceSha256,
    )
  }
  const nativeInventory = inspectNativePackageFiles(packageRoot, manifest, releaseArtifacts)
  const {
    findings: secretFindings,
    coverage: secretCoverage,
    includedPaths,
    includedFileHashes,
  } = await scanPackageText(packageRoot)
  const licenseManifest = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "resources", "dependency-licenses", "manifest.json"),
      "utf8",
    ),
  )
  const dependencies = summarizeDependencyLicenses(
    JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")),
    licenseOverrides,
    { includedPaths, includedFileHashes, licenseManifest },
  )
  if (secretFindings.length > 0) {
    throw new Error(
      `Package secret scan found ${secretFindings.length} potential credential(s): ${secretFindings.map((finding) => `${finding.path} (${finding.kind})`).join(", ")}`,
    )
  }
  const signatures = nativeInventory.map(
    ({ filePath, path: displayPath, origin, signaturePolicy }) => ({
      ...inspectAuthenticode(filePath, displayPath),
      origin,
      signaturePolicy,
    }),
  )
  const publisher = channel === "release" ? expectedWindowsPublisher(process.env) : null
  assertAuthenticodePolicy(signatures, channel, publisher)
  const scanRoot = channel === "release" ? path.dirname(packageRoot) : packageRoot
  const scanManifest = await collectPackageFiles(scanRoot)
  const scanTargetSha256 = packageManifestDigest(scanManifest)
  const malwareScan = args.includes("--malware-scan")
    ? {
        ...runWindowsDefenderScan(scanRoot),
        scanTargetSha256,
      }
    : {
        status: "not-run",
        reason:
          "Run an approved native antivirus scan against the exact artifact and attach its evidence before release acceptance.",
      }
  if (args.includes("--malware-scan")) {
    const scanManifestAfter = await collectPackageFiles(scanRoot)
    if (packageManifestDigest(scanManifestAfter) !== scanTargetSha256) {
      throw new Error("Windows malware scan target changed while it was being scanned")
    }
  }
  assertMalwareScanPolicy(malwareScan, channel, {
    scanTarget: scanRoot,
    scanTargetSha256,
  })
  const report = {
    schemaVersion: 2,
    channel,
    generatedAt: new Date().toISOString(),
    source: {
      ...source,
      version: packageJson.version,
    },
    provenance: {
      embeddedPath: "resources/package-provenance.json",
      sha256: provenanceSha256,
      manifest: provenance,
    },
    artifact: {
      app: path.basename(appPath),
      platform: "win32-x64",
      files: manifest,
      releaseArtifacts: releaseArtifacts.map(({ filePath: _filePath, ...artifact }) => artifact),
      nativeInventory: nativeInventory.map(({ filePath: _filePath, ...entry }) => entry),
    },
    authenticode: {
      policy:
        channel === "release"
          ? "valid-timestamped-expected-publisher-required"
          : "unsigned-preview-allowed",
      expectedPublisher: publisher,
      signatures,
    },
    dependencies,
    secretScan: { status: "pass", findings: [], coverage: secretCoverage },
    malwareScan,
  }
  const outputPath = path.resolve(outputArgument)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`
  fs.writeFileSync(outputPath, reportBytes)
  fs.writeFileSync(
    `${outputPath}.sha256`,
    `${createHash("sha256").update(reportBytes).digest("hex")}  ${path.basename(outputPath)}\n`,
  )
  console.log(`Windows package security report: ${outputPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
