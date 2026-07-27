#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertAuthenticodePolicy,
  collectPackageFiles,
  expectedWindowsPublisher,
  inspectAuthenticode,
} from "./audit-windows-package.mjs"
import { sha256File } from "./lib/packaged-binary.mjs"
import { packageProvenanceDigest } from "./lib/package-provenance.mjs"

function expectedArtifactNames(version) {
  return [`Flapstack-Setup-${version}-x64.exe`, `Flapstack-Portable-${version}-x64.exe`]
}

function equalManifest(left, right) {
  const select = (entries) =>
    entries.map(({ path: filePath, bytes, sha256 }) => ({
      path: filePath,
      bytes,
      sha256,
    }))
  return JSON.stringify(select(left)) === JSON.stringify(select(right))
}

function equalSignatureEvidence(left, right) {
  const select = (entries) =>
    entries
      .map((entry) => ({
        path: entry.path,
        origin: entry.origin,
        signaturePolicy: entry.signaturePolicy,
        status: entry.status,
        subject: entry.subject,
        thumbprint: String(entry.thumbprint || "")
          .replace(/[^a-fA-F0-9]/g, "")
          .toUpperCase(),
        timestamped: entry.timestamped,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  return JSON.stringify(select(left)) === JSON.stringify(select(right))
}

function resolveInventoryPath(releaseRoot, filePath, releaseArtifactPaths) {
  const normalized = String(filePath || "").replaceAll("\\", "/")
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unsafe Windows signature inventory path: ${normalized}`)
  }
  return releaseArtifactPaths.has(normalized)
    ? path.join(releaseRoot, normalized)
    : path.join(releaseRoot, "win-unpacked", ...normalized.split("/"))
}

export async function verifyWindowsSecurityReport(options) {
  const releaseRoot = path.resolve(options.releaseRoot)
  const reportPath = path.resolve(options.reportPath)
  const expectedSha = String(options.expectedSha || "").toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) {
    throw new Error("Windows release verification requires the expected 40-character source SHA")
  }
  if (path.dirname(reportPath) !== releaseRoot) {
    throw new Error("Windows security report must be directly inside the sealed release root")
  }
  const reportBytes = readFileSync(reportPath)
  const reportHash = createHash("sha256").update(reportBytes).digest("hex")
  const sidecarPath = `${reportPath}.sha256`
  const sidecarBytes = readFileSync(sidecarPath)
  const sidecar = sidecarBytes.toString("utf8").trim()
  const sidecarMatch = /^([a-f0-9]{64})[ ]{2}([^/\\]+)$/i.exec(sidecar)
  if (
    !sidecarMatch ||
    sidecarMatch[1].toLowerCase() !== reportHash ||
    sidecarMatch[2] !== path.basename(reportPath)
  ) {
    throw new Error("Windows security report hash sidecar does not match the exact report")
  }
  const report = JSON.parse(reportBytes.toString("utf8"))
  if (report.schemaVersion !== 2 || report.channel !== "release") {
    throw new Error("Windows security report is not a release audit")
  }
  if (report.source?.version !== options.version) {
    throw new Error("Windows security report version does not match the release version")
  }
  if (String(report.source?.sha || "").toLowerCase() !== expectedSha) {
    throw new Error("Windows security report source SHA does not match the release commit")
  }
  const provenance = report.provenance?.manifest
  if (
    provenance?.integrity?.algorithm !== "sha256" ||
    provenance.integrity.value !== packageProvenanceDigest(provenance)
  ) {
    throw new Error("Windows security report contains invalid package provenance integrity")
  }
  if (String(provenance.source?.sha || "").toLowerCase() !== expectedSha) {
    throw new Error("Embedded package provenance source SHA does not match the release commit")
  }
  const embeddedProvenancePath = path.join(
    releaseRoot,
    "win-unpacked",
    "resources",
    "package-provenance.json",
  )
  const embeddedProvenanceBytes = readFileSync(embeddedProvenancePath)
  const embeddedProvenanceHash = createHash("sha256").update(embeddedProvenanceBytes).digest("hex")
  if (
    report.provenance?.embeddedPath !== "resources/package-provenance.json" ||
    report.provenance?.sha256 !== embeddedProvenanceHash
  ) {
    throw new Error("Embedded package provenance hash does not match the security report")
  }
  const embeddedProvenance = JSON.parse(embeddedProvenanceBytes.toString("utf8"))
  if (JSON.stringify(embeddedProvenance) !== JSON.stringify(provenance)) {
    throw new Error("Embedded package provenance does not match the security report")
  }
  const artifactNames = expectedArtifactNames(options.version)
  const expectedRootEntries = [
    "win-unpacked",
    ...artifactNames,
    path.basename(reportPath),
    path.basename(sidecarPath),
  ].sort()
  const actualRootEntries = readdirSync(releaseRoot).sort()
  if (JSON.stringify(actualRootEntries) !== JSON.stringify(expectedRootEntries)) {
    throw new Error(
      `Unexpected release-root artifacts: expected ${expectedRootEntries.join(", ")}; found ${actualRootEntries.join(", ")}`,
    )
  }
  const reportedArtifacts = report.artifact?.releaseArtifacts ?? []
  if (
    reportedArtifacts.length !== artifactNames.length ||
    artifactNames.some((name) => !reportedArtifacts.some((artifact) => artifact.path === name))
  ) {
    throw new Error("Windows security report does not contain the exact release artifacts")
  }
  for (const name of artifactNames) {
    const artifact = reportedArtifacts.find((candidate) => candidate.path === name)
    const artifactPath = path.join(releaseRoot, name)
    const bytes = readFileSync(artifactPath).length
    const sha256 = await sha256File(artifactPath)
    if (artifact.bytes !== bytes || artifact.sha256 !== sha256) {
      throw new Error(`${name}: release artifact changed after audit`)
    }
  }
  const packageFiles = await collectPackageFiles(path.join(releaseRoot, "win-unpacked"))
  if (!equalManifest(report.artifact?.files ?? [], packageFiles)) {
    throw new Error("Windows unpacked package changed after audit")
  }
  const nativeInventory = report.artifact?.nativeInventory ?? []
  const reportedSignatures = report.authenticode?.signatures ?? []
  const inventoryPaths = nativeInventory.map((entry) => entry.path).sort()
  const signaturePaths = reportedSignatures.map((entry) => entry.path).sort()
  if (
    inventoryPaths.length === 0 ||
    new Set(inventoryPaths).size !== inventoryPaths.length ||
    JSON.stringify(inventoryPaths) !== JSON.stringify(signaturePaths)
  ) {
    throw new Error("Windows security report signature inventory is incomplete")
  }
  const releaseArtifactPaths = new Set(artifactNames)
  const inspectSignature = options.inspectAuthenticode ?? inspectAuthenticode
  const freshSignatures = nativeInventory.map((entry) => {
    const filePath = resolveInventoryPath(releaseRoot, entry.path, releaseArtifactPaths)
    return {
      ...inspectSignature(filePath, entry.path),
      path: entry.path,
      origin: entry.origin,
      signaturePolicy: entry.signaturePolicy,
    }
  })
  assertAuthenticodePolicy(
    freshSignatures,
    "release",
    options.expectedPublisher ?? expectedWindowsPublisher(process.env),
  )
  if (!equalSignatureEvidence(reportedSignatures, freshSignatures)) {
    throw new Error("Fresh Authenticode evidence does not match the Windows security report")
  }

  if (JSON.stringify(readdirSync(releaseRoot).sort()) !== JSON.stringify(expectedRootEntries)) {
    throw new Error("Windows release root changed during fresh signature verification")
  }
  if (
    !reportBytes.equals(readFileSync(reportPath)) ||
    !sidecarBytes.equals(readFileSync(sidecarPath))
  ) {
    throw new Error("Windows security report changed during fresh signature verification")
  }
  for (const name of artifactNames) {
    const artifact = reportedArtifacts.find((candidate) => candidate.path === name)
    const artifactPath = path.join(releaseRoot, name)
    const bytes = readFileSync(artifactPath).length
    const sha256 = await sha256File(artifactPath)
    if (artifact.bytes !== bytes || artifact.sha256 !== sha256) {
      throw new Error(`${name}: release artifact changed during fresh signature verification`)
    }
  }
  const finalPackageFiles = await collectPackageFiles(path.join(releaseRoot, "win-unpacked"))
  if (!equalManifest(packageFiles, finalPackageFiles)) {
    throw new Error("Windows unpacked package changed during fresh signature verification")
  }
  return { reportHash, artifacts: artifactNames.length, packageFiles: packageFiles.length }
}

function parseArg(args, name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const releaseRoot = parseArg(args, "--release-root")
  const reportPath = parseArg(args, "--report")
  const version = parseArg(args, "--version")
  const expectedSha = parseArg(args, "--expected-sha")
  if (!releaseRoot || !reportPath || !version || !expectedSha) {
    throw new Error(
      "Usage: --release-root=<dir> --report=<json> --version=<version> --expected-sha=<sha>",
    )
  }
  await verifyWindowsSecurityReport({ releaseRoot, reportPath, version, expectedSha })
  console.log("Windows release directory and security report are sealed and verified")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
