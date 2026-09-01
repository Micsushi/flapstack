#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs, { createReadStream } from "node:fs"
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
import { inspectBinaryArchitecture, sha256File } from "./lib/packaged-binary.mjs"
import { readPackageSourceState } from "./lib/package-provenance.mjs"

const require = createRequire(import.meta.url)
const asar = require("@electron/asar")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SECRET_SCAN_OVERLAP_BYTES = 64 * 1024
const BUILD_OUTPUT_EXTENSIONS = new Set([".exp", ".iobj", ".ilk", ".ipdb", ".lib", ".obj", ".pdb"])
const NATIVE_FORMATS = new Set(["elf", "mach-o", "mach-o-fat", "pe"])
const MACHO_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
])

function relativePath(base, file) {
  return path.relative(base, file).split(path.sep).join("/")
}

function inside(base, candidate) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`)
}

function parseArg(args, name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export async function collectLinuxPackageFiles(packageRoot) {
  const base = path.resolve(packageRoot)
  const rootStat = await lstat(base)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Audited Linux package root must be a real directory")
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
        const resolvedTarget = path.resolve(path.dirname(absolute), target)
        if (path.isAbsolute(target) || !inside(base, resolvedTarget)) {
          throw new Error(`${displayPath}: package symlink escapes its package root`)
        }
        await lstat(resolvedTarget)
        entries.push({
          path: displayPath,
          kind: "symlink",
          target,
          bytes: Buffer.byteLength(target),
          sha256: createHash("sha256").update(`symlink\0${target}`).digest("hex"),
        })
      } else if (stat.isDirectory()) {
        await visit(absolute)
      } else if (stat.isFile()) {
        entries.push({
          path: displayPath,
          kind: "file",
          bytes: stat.size,
          mode: stat.mode & 0o777,
          sha256: await sha256File(absolute),
        })
      } else {
        throw new Error(`${displayPath}: package entry is not a regular file or safe symlink`)
      }
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
      if (!seen.has(key)) {
        seen.add(key)
        findings.push(finding)
      }
    }
    overlap = chunk.subarray(Math.max(0, chunk.length - SECRET_SCAN_OVERLAP_BYTES))
  }
  return findings
}

async function scanLinuxPackageText(packageRoot, manifest) {
  const findings = []
  const includedPaths = new Set()
  const includedFileHashes = new Map()
  let externalFiles = 0
  let externalBytes = 0
  for (const item of manifest) {
    if (item.kind !== "file") continue
    includedPaths.add(item.path)
    includedFileHashes.set(item.path, item.sha256)
    externalFiles += 1
    externalBytes += item.bytes
    if (item.path === "resources/app.asar") continue
    findings.push(
      ...(await scanFileForSecrets(path.join(packageRoot, ...item.path.split("/")), item.path)),
    )
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
    assertNoEmbeddedNativePayload(displayPath, buffer, stat.unpacked)
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

export function assertNoEmbeddedNativePayload(filePath, buffer, unpacked = false) {
  if (unpacked) return
  const extension = path.posix.extname(filePath).toLowerCase()
  if (BUILD_OUTPUT_EXTENSIONS.has(extension)) {
    throw new Error(`${filePath}: native build output must not be distributed`)
  }
  const elf =
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  const machO = buffer.length >= 4 && MACHO_MAGICS.has(buffer.readUInt32BE(0))
  let pe = false
  if (buffer.length >= 64 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c)
    pe =
      peOffset + 4 <= buffer.length && buffer.toString("ascii", peOffset, peOffset + 4) === "PE\0\0"
  }
  if (elf || machO || pe) {
    throw new Error(`${filePath}: native payload must be unpacked and inventoried`)
  }
}

export function assertLinuxNativeInventory(entries, architecture) {
  if (!new Set(["arm64", "x64"]).has(architecture)) {
    throw new Error(`Unsupported Linux architecture: ${architecture}`)
  }
  if (entries.length === 0) throw new Error("Linux package contains no native binaries")
  for (const entry of entries) {
    const extension = path.posix.extname(entry.path).toLowerCase()
    if (BUILD_OUTPUT_EXTENSIONS.has(extension) || entry.format === "build-output") {
      throw new Error(`${entry.path}: native build output must not be distributed`)
    }
    if (entry.format !== "elf" || !entry.architectures.includes(architecture)) {
      throw new Error(`${entry.path}: native package file must be Linux ELF ${architecture}`)
    }
  }
}

export function inspectLinuxNativeFiles(packageRoot, manifest, architecture) {
  const entries = []
  for (const item of manifest) {
    if (item.kind !== "file") continue
    const extension = path.posix.extname(item.path).toLowerCase()
    const filePath = path.join(packageRoot, ...item.path.split("/"))
    const inspection = BUILD_OUTPUT_EXTENSIONS.has(extension)
      ? { format: "build-output", architectures: [] }
      : inspectBinaryArchitecture(filePath)
    const nativeExtension =
      extension === ".node" || /\.so(?:\.\d+)*$/i.test(path.posix.basename(item.path))
    if (
      !BUILD_OUTPUT_EXTENSIONS.has(extension) &&
      !nativeExtension &&
      !NATIVE_FORMATS.has(inspection.format)
    ) {
      continue
    }
    entries.push({ path: item.path, bytes: item.bytes, sha256: item.sha256, ...inspection })
  }
  assertLinuxNativeInventory(entries, architecture)
  return entries
}

function dependencyNames(value) {
  return new Set(
    String(value || "")
      .split(",")
      .flatMap((entry) => entry.split("|"))
      .map((entry) => entry.trim().match(/^([a-z0-9][a-z0-9+.-]*)/i)?.[1])
      .filter(Boolean),
  )
}

export function assertDebPackageMetadata(metadata, expected) {
  const packageName = expected.channel === "preview" ? "flapstack-preview" : "flapstack"
  const debArchitecture = expected.architecture === "x64" ? "amd64" : "arm64"
  if (metadata.Package !== packageName) {
    throw new Error(`Debian package identity must be ${packageName}`)
  }
  if (metadata.Version !== expected.version) {
    throw new Error(`Debian package version must be ${expected.version}`)
  }
  if (metadata.Architecture !== debArchitecture) {
    throw new Error(`Debian package architecture must be ${debArchitecture}`)
  }
  const actualDependencies = dependencyNames(metadata.Depends)
  for (const dependency of expected.dependencies) {
    if (!actualDependencies.has(dependency)) {
      throw new Error(`Debian package is missing runtime dependency ${dependency}`)
    }
  }
}

export function assertLinuxPackageDirectoryMode(mode, label) {
  const permissions = mode & 0o777
  if (permissions !== 0o755) {
    throw new Error(`${label} must use mode 0755, found 0${permissions.toString(8)}`)
  }
}

export function assertDebPostInstallScript(contents, expected) {
  const productDirectory = expected.channel === "preview" ? "Flapstack-Preview" : "Flapstack"
  const applicationDirectory = `/opt/${productDirectory}`
  const requiredLines = [
    "# flapstack-install-mode-v1",
    `chmod 0755 -- "${applicationDirectory}"`,
    `chmod 0755 -- "${applicationDirectory}/resources"`,
  ]
  const lines = new Set(
    String(contents)
      .split(/\r?\n/)
      .map((line) => line.trim()),
  )
  for (const requiredLine of requiredLines) {
    if (!lines.has(requiredLine)) {
      throw new Error(`Debian post-install script must contain: ${requiredLine}`)
    }
  }
}

export function assertLinuxDesktopEntry(contents, expected) {
  const preview = expected.channel === "preview"
  const executable =
    expected.kind === "appimage"
      ? "AppRun"
      : preview
        ? "/opt/Flapstack-Preview/flapstack-preview"
        : "/opt/Flapstack/flapstack"
  const protocol = preview ? "flapstack-preview" : "flapstack"
  const execLine = contents.split(/\r?\n/).find((line) => line.startsWith("Exec=")) ?? ""
  const mimeLine = contents.split(/\r?\n/).find((line) => line.startsWith("MimeType=")) ?? ""
  if (!execLine.startsWith(`Exec=${executable}`)) {
    throw new Error(`Linux desktop entry must launch ${executable}`)
  }
  if (/(?:^|\s)--no-sandbox(?:\s|$)/.test(execLine)) {
    throw new Error("Linux desktop entry must not disable Chromium sandboxing")
  }
  if (!mimeLine.split(/[=;]/).includes(`x-scheme-handler/${protocol}`)) {
    throw new Error(`Linux desktop entry must register ${protocol} protocol handling`)
  }
}

export function assertEmbeddedProvenance(actualBytes, expectedBytes, label) {
  const actualSha256 = createHash("sha256").update(actualBytes).digest("hex")
  const expectedSha256 = createHash("sha256").update(expectedBytes).digest("hex")
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label}: embedded package provenance does not match the inspected app`)
  }
  return actualSha256
}

function parseDebFields(raw) {
  const fields = {}
  let current
  for (const line of String(raw).split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line)
    if (match) {
      current = match[1]
      fields[current] = match[2]
    } else if (current && /^\s/.test(line)) {
      fields[current] += ` ${line.trim()}`
    }
  }
  return fields
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message || String(result.stderr || "").trim() || `exit ${result.status}`
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`)
  }
  return String(result.stdout || "")
}

function readRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file`)
  }
  return fs.readFileSync(filePath)
}

async function inspectDebArtifact(outputRoot, expected, provenanceBytes) {
  const candidates = fs
    .readdirSync(outputRoot)
    .filter((entry) => entry.endsWith(".deb"))
    .map((entry) => path.join(outputRoot, entry))
  const matches = []
  for (const candidate of candidates) {
    const metadata = parseDebFields(run("dpkg-deb", ["--field", candidate]))
    try {
      assertDebPackageMetadata(metadata, expected)
      matches.push({ candidate, metadata })
    } catch {
      // Another architecture or channel may share the output directory.
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching Debian artifact, found ${matches.length}`)
  }
  const [{ candidate, metadata }] = matches
  const extractionRoot = fs.mkdtempSync(path.join(tmpdir(), "flapstack-linux-audit-"))
  try {
    run("dpkg-deb", ["--extract", candidate, extractionRoot])
    const controlRoot = path.join(extractionRoot, ".control")
    fs.mkdirSync(controlRoot)
    run("dpkg-deb", ["--control", candidate, controlRoot])
    const preview = expected.channel === "preview"
    const packageName = preview ? "flapstack-preview" : "flapstack"
    const productDirectory = preview ? "Flapstack-Preview" : "Flapstack"
    const executablePath = path.join(extractionRoot, "opt", productDirectory, packageName)
    const resourcesPath = path.join(extractionRoot, "opt", productDirectory, "resources")
    assertLinuxPackageDirectoryMode(
      fs.lstatSync(path.dirname(executablePath)).mode,
      "Debian application directory",
    )
    assertLinuxPackageDirectoryMode(fs.lstatSync(resourcesPath).mode, "Debian resources directory")
    const postInstallPath = path.join(controlRoot, "postinst")
    assertDebPostInstallScript(
      readRegularFile(postInstallPath, "Debian post-install script").toString("utf8"),
      expected,
    )
    const executableStat = fs.lstatSync(executablePath)
    if (
      executableStat.isSymbolicLink() ||
      !executableStat.isFile() ||
      !(executableStat.mode & 0o111)
    ) {
      throw new Error("Debian package application executable is missing or not executable")
    }
    const desktopPath = path.join(
      extractionRoot,
      "usr",
      "share",
      "applications",
      `${packageName}.desktop`,
    )
    assertLinuxDesktopEntry(
      readRegularFile(desktopPath, "Debian desktop entry").toString("utf8"),
      expected,
    )
    const embeddedProvenance = readRegularFile(
      path.join(resourcesPath, "package-provenance.json"),
      "Debian embedded package provenance",
    )
    const embeddedProvenanceSha256 = assertEmbeddedProvenance(
      embeddedProvenance,
      provenanceBytes,
      path.basename(candidate),
    )
    return {
      path: path.basename(candidate),
      bytes: fs.lstatSync(candidate).size,
      sha256: await sha256File(candidate),
      metadata,
      desktopEntry: relativePath(extractionRoot, desktopPath),
      executable: relativePath(extractionRoot, executablePath),
      postInstall: relativePath(extractionRoot, postInstallPath),
      embeddedProvenanceSha256,
    }
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true })
  }
}

async function inspectAppImageArtifact(outputRoot, architecture, expected, provenanceBytes) {
  const matches = []
  for (const entry of fs.readdirSync(outputRoot).filter((name) => name.endsWith(".AppImage"))) {
    const filePath = path.join(outputRoot, entry)
    const stat = fs.lstatSync(filePath)
    if (stat.isSymbolicLink() || !stat.isFile()) continue
    const inspection = inspectBinaryArchitecture(filePath)
    if (inspection.format === "elf" && inspection.architectures.includes(architecture)) {
      matches.push({ filePath, entry, stat, inspection })
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching AppImage artifact, found ${matches.length}`)
  }
  const [{ filePath, entry, stat, inspection }] = matches
  if (!(stat.mode & 0o111)) throw new Error("AppImage artifact must be executable")
  const sha256 = await sha256File(filePath)
  const extractionRoot = fs.mkdtempSync(path.join(tmpdir(), "flapstack-appimage-audit-"))
  try {
    run(filePath, ["--appimage-extract"], {
      cwd: extractionRoot,
      timeout: 5 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    const squashfsRoot = path.join(extractionRoot, "squashfs-root")
    const extracted = await collectLinuxPackageFiles(squashfsRoot)
    const provenanceEntries = extracted.filter(
      (item) => item.kind === "file" && item.path.endsWith("resources/package-provenance.json"),
    )
    if (provenanceEntries.length !== 1) {
      throw new Error("AppImage must contain exactly one package provenance manifest")
    }
    const embeddedProvenance = fs.readFileSync(
      path.join(squashfsRoot, ...provenanceEntries[0].path.split("/")),
    )
    const embeddedProvenanceSha256 = assertEmbeddedProvenance(
      embeddedProvenance,
      provenanceBytes,
      entry,
    )
    const packageName = expected.channel === "preview" ? "flapstack-preview" : "flapstack"
    const desktopEntries = extracted.filter(
      (item) => item.kind === "file" && item.path.endsWith(`${packageName}.desktop`),
    )
    if (desktopEntries.length !== 1) {
      throw new Error(`AppImage must contain exactly one ${packageName}.desktop entry`)
    }
    assertLinuxDesktopEntry(
      fs.readFileSync(path.join(squashfsRoot, ...desktopEntries[0].path.split("/")), "utf8"),
      { ...expected, kind: "appimage" },
    )
    if ((await sha256File(filePath)) !== sha256) {
      throw new Error("AppImage artifact changed during payload extraction")
    }
    return {
      path: entry,
      bytes: stat.size,
      sha256,
      embeddedProvenanceSha256,
      desktopEntry: desktopEntries[0].path,
      ...inspection,
    }
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true })
  }
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("Linux package security audit must run on native Linux")
  }
  const args = process.argv.slice(2)
  const appArgument = parseArg(args, "--app")
  const platform = parseArg(args, "--platform")
  const channel = parseArg(args, "--channel") ?? "preview"
  const outputArgument = parseArg(args, "--output")
  if (!appArgument || !/^linux-(?:arm64|x64)$/.test(platform || "") || !outputArgument) {
    throw new Error(
      "Usage: --app=<executable> --platform=linux-arm64|linux-x64 --channel=preview|release --output=<report.json>",
    )
  }
  if (!new Set(["preview", "release"]).has(channel)) {
    throw new Error(`Unsupported Linux audit channel: ${channel}`)
  }
  const architecture = platform.slice("linux-".length)
  const appPath = path.resolve(appArgument)
  const packageRoot = path.dirname(appPath)
  const outputRoot = path.dirname(packageRoot)
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const expectedProductName =
    channel === "preview" ? "Flapstack Preview" : packageJson.build.productName
  const expectedExecutable = channel === "preview" ? "flapstack-preview" : "flapstack"
  const appStat = fs.lstatSync(appPath)
  if (
    appStat.isSymbolicLink() ||
    !appStat.isFile() ||
    path.basename(appPath) !== expectedExecutable
  ) {
    throw new Error(`Audited Linux app must be the regular ${expectedExecutable} executable`)
  }

  const manifest = await collectLinuxPackageFiles(packageRoot)
  const source = readPackageSourceState(root)
  if (channel === "release") assertReleaseSourceState(source)
  const provenancePath = path.join(packageRoot, "resources", "package-provenance.json")
  const provenanceBytes = readRegularFile(provenancePath, "Package provenance manifest")
  const provenance = JSON.parse(provenanceBytes.toString("utf8"))
  assertPackageProvenance(provenance, {
    source,
    version: packageJson.version,
    productName: expectedProductName,
    channel,
    platform: "linux",
    architecture,
  })
  const provenanceSha256 = await sha256File(provenancePath)
  const nativeInventory = inspectLinuxNativeFiles(packageRoot, manifest, architecture)
  const scan = await scanLinuxPackageText(packageRoot, manifest)
  if (scan.findings.length > 0) {
    throw new Error(
      `Package secret scan found ${scan.findings.length} potential credential(s): ${scan.findings
        .map((finding) => `${finding.path} (${finding.kind})`)
        .join(", ")}`,
    )
  }
  const licenseManifest = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, "resources", "dependency-licenses", "manifest.json"),
      "utf8",
    ),
  )
  const dependencies = summarizeDependencyLicenses(
    JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")),
    JSON.parse(
      fs.readFileSync(path.join(root, "build", "dependency-license-overrides.json"), "utf8"),
    ),
    {
      includedPaths: scan.includedPaths,
      includedFileHashes: scan.includedFileHashes,
      licenseManifest,
    },
  )
  const expectedArtifact = {
    channel,
    version: packageJson.version,
    architecture,
    dependencies: packageJson.build.deb.depends,
  }
  const deb = await inspectDebArtifact(outputRoot, expectedArtifact, provenanceBytes)
  const appImage = await inspectAppImageArtifact(
    outputRoot,
    architecture,
    expectedArtifact,
    provenanceBytes,
  )
  const report = {
    schemaVersion: 1,
    channel,
    generatedAt: new Date().toISOString(),
    source: { ...source, version: packageJson.version },
    provenance: {
      embeddedPath: "resources/package-provenance.json",
      sha256: provenanceSha256,
      manifest: provenance,
    },
    artifact: {
      app: path.basename(appPath),
      platform,
      files: manifest,
      nativeInventory,
      deb,
      appImage,
    },
    dependencies,
    secretScan: { status: "pass", findings: [], coverage: scan.coverage },
  }
  const outputPath = path.resolve(outputArgument)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`
  fs.writeFileSync(outputPath, reportBytes)
  fs.writeFileSync(
    `${outputPath}.sha256`,
    `${createHash("sha256").update(reportBytes).digest("hex")}  ${path.basename(outputPath)}\n`,
  )
  console.log(`Linux package security report: ${outputPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
