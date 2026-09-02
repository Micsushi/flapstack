import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import {
  assertBundledBinary,
  ensureRealDirectory,
  inspectBinaryArchitecture,
  replaceDirectoryAtomically,
} from "./packaged-binary.mjs"

function packageNamesForTarget(target) {
  if (target !== "darwin-arm64" && target !== "darwin-x64") return []
  const architecture = target.slice("darwin-".length)
  return [
    `@img/sharp-darwin-${architecture}`,
    `@img/sharp-libvips-darwin-${architecture}`,
    `@openai/codex-darwin-${architecture}`,
  ]
}

function lockPackage(lock, name, target) {
  const value = lock.packages?.[`node_modules/${name}`]
  const architecture = target.slice("darwin-".length)
  if (
    !value ||
    value.optional !== true ||
    !value.os?.includes("darwin") ||
    !value.cpu?.includes(architecture) ||
    typeof value.version !== "string" ||
    !/^https:\/\/registry\.npmjs\.org\//.test(value.resolved ?? "") ||
    !/^sha512-[A-Za-z0-9+/]+=*$/.test(value.integrity ?? "")
  ) {
    throw new Error(`${name}: package-lock metadata is missing or invalid for ${target}`)
  }
  return {
    name,
    packageName: value.name ?? name,
    target,
    version: value.version,
    integrity: value.integrity,
  }
}

export function resolveDarwinTargetPackages(targets, lock) {
  const unique = new Map()
  for (const target of targets) {
    for (const name of packageNamesForTarget(target)) {
      const spec = lockPackage(lock, name, target)
      unique.set(name, spec)
    }
  }
  return [...unique.values()]
}

function walkRegularFiles(directory, relative = "") {
  const files = []
  for (const entry of readdirSync(path.join(directory, relative)).sort()) {
    const childRelative = path.join(relative, entry)
    const child = path.join(directory, childRelative)
    const stat = lstatSync(child)
    if (stat.isSymbolicLink()) throw new Error(`${child}: staged npm package contains a symlink`)
    if (stat.isDirectory()) files.push(...walkRegularFiles(directory, childRelative))
    else if (stat.isFile()) files.push(child)
    else throw new Error(`${child}: staged npm package contains a non-regular entry`)
  }
  return files
}

function validateInstalledPackage(directory, spec) {
  const stat = lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${directory}: target dependency must be a real directory`)
  }
  const manifestPath = path.join(directory, "package.json")
  const manifestStat = lstatSync(manifestPath)
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error(`${manifestPath}: target dependency manifest must be a regular file`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const architecture = spec.target.slice("darwin-".length)
  if (
    manifest.name !== spec.packageName ||
    manifest.version !== spec.version ||
    !manifest.os?.includes("darwin") ||
    !manifest.cpu?.includes(architecture)
  ) {
    throw new Error(`${spec.name}: installed package metadata does not match ${spec.target}`)
  }
  const nativeFiles = walkRegularFiles(directory).filter((file) =>
    inspectBinaryArchitecture(file).format.startsWith("mach-o"),
  )
  if (nativeFiles.length === 0)
    throw new Error(`${spec.name}: installed package has no native file`)
  for (const file of nativeFiles) {
    assertBundledBinary(file, spec.target, { requireExecutable: false })
  }
}

function requirePackResult(result, spec, archiveRoot) {
  if (result.error) throw result.error
  if (result.signal) throw new Error(`npm pack for ${spec.name} terminated by ${result.signal}`)
  if (result.status !== 0) {
    throw new Error(`npm pack for ${spec.name} failed with exit code ${result.status}`)
  }
  let values
  try {
    values = JSON.parse(result.stdout)
  } catch {
    throw new Error(`npm pack for ${spec.name} returned invalid JSON`)
  }
  const value = Array.isArray(values) && values.length === 1 ? values[0] : null
  if (
    !value ||
    value.integrity !== spec.integrity ||
    !/^[^/\\]+\.tgz$/.test(value.filename ?? "")
  ) {
    throw new Error(`${spec.name}: npm pack metadata does not match package-lock`)
  }
  const archive = path.resolve(archiveRoot, value.filename)
  if (path.dirname(archive) !== archiveRoot)
    throw new Error(`${spec.name}: unsafe npm archive path`)
  const archiveStat = lstatSync(archive)
  if (archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw new Error(`${spec.name}: npm archive must be a regular file`)
  }
  const actualIntegrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`
  if (actualIntegrity !== spec.integrity) {
    throw new Error(`${spec.name}: npm archive integrity does not match package-lock`)
  }
  return archive
}

export async function prepareDarwinTargetDependencies(targets, options = {}) {
  const root = path.resolve(options.root ?? process.cwd())
  if (targets.flatMap(packageNamesForTarget).length === 0) return []
  const lock =
    options.lock ?? JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"))
  const packages = resolveDarwinTargetPackages(targets, lock)
  const modulesDirectory = path.join(root, "node_modules")
  ensureRealDirectory(modulesDirectory)
  const archiveRoot = mkdtempSync(path.join(modulesDirectory, ".darwin-package-archives-"))
  const npm = options.npm ?? (process.platform === "win32" ? "npm.cmd" : "npm")
  const runner = options.spawn ?? spawnSync
  const staged = []
  try {
    for (const spec of packages) {
      const targetDirectory = path.join(root, "node_modules", ...spec.name.split("/"))
      const scopeDirectory = path.dirname(targetDirectory)
      ensureRealDirectory(scopeDirectory)
      const result = runner(
        npm,
        [
          "pack",
          "--json",
          "--ignore-scripts",
          `--pack-destination=${archiveRoot}`,
          `${spec.packageName}@${spec.version}`,
        ],
        { cwd: root, encoding: "utf8" },
      )
      const archive = requirePackResult(result, spec, archiveRoot)
      const stagingDirectory = mkdtempSync(
        path.join(scopeDirectory, `.${path.basename(targetDirectory)}-stage-`),
      )
      staged.push(stagingDirectory)
      const extraction = runner(
        "tar",
        ["-xzf", archive, "-C", stagingDirectory, "--strip-components=1"],
        { cwd: root, encoding: "utf8" },
      )
      if (extraction.error) throw extraction.error
      if (extraction.signal) {
        throw new Error(`tar extraction for ${spec.name} terminated by ${extraction.signal}`)
      }
      if (extraction.status !== 0) {
        throw new Error(
          `tar extraction for ${spec.name} failed with exit code ${extraction.status}`,
        )
      }
      validateInstalledPackage(stagingDirectory, spec)
      replaceDirectoryAtomically(stagingDirectory, targetDirectory)
      staged.pop()
    }
    return packages.map(({ name, version }) => `${name}@${version}`)
  } finally {
    for (const directory of staged) rmSync(directory, { recursive: true, force: true })
    rmSync(archiveRoot, { recursive: true, force: true })
  }
}
