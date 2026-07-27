import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

export const PACKAGE_PROVENANCE_SCHEMA_VERSION = 1

function git(root, args, runner = spawnSync) {
  const result = runner("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || "").trim() || "unknown error"
    throw new Error(`Could not read package source provenance (git ${args.join(" ")}): ${detail}`)
  }
  return String(result.stdout ?? "")
}

function optionalGitConfig(root, key, runner = spawnSync) {
  const result = runner("git", ["config", "--bool", key], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error) {
    throw new Error(
      `Could not read package source provenance (git config): ${result.error.message}`,
    )
  }
  if (result.status === 1) return ""
  if (result.status !== 0) {
    throw new Error(
      `Could not read package source provenance (git config): ${String(result.stderr || "").trim()}`,
    )
  }
  return String(result.stdout ?? "").trim()
}

function hashSourceFiles(root, paths) {
  const digest = createHash("sha256")
  for (const relativePath of paths) {
    const absolutePath = path.join(root, ...relativePath.split("/"))
    const stat = lstatSync(absolutePath)
    digest.update(relativePath)
    digest.update("\0")
    if (stat.isSymbolicLink()) {
      digest.update("symlink\0")
      digest.update(readlinkSync(absolutePath))
    } else if (stat.isFile()) {
      digest.update("file\0")
      digest.update(readFileSync(absolutePath))
    } else {
      throw new Error(`${relativePath}: package source input is not a regular file or symlink`)
    }
    digest.update("\0")
  }
  return digest.digest("hex")
}

function gitBlobHash(buffer) {
  return createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex")
}

function parseIndexEntries(raw) {
  const entries = new Map()
  for (const record of raw.split("\0").filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]{40,64}) (\d+)\t(.+)$/i.exec(record)
    if (!match || match[3] !== "0") {
      throw new Error("Package source provenance could not parse the Git index")
    }
    entries.set(match[4].split(path.sep).join("/"), {
      mode: match[1],
      hash: match[2].toLowerCase(),
    })
  }
  return entries
}

function parseHeadEntries(raw) {
  const entries = new Map()
  for (const record of raw.split("\0").filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]{40,64})\t(.+)$/i.exec(record)
    if (!match) throw new Error("Package source provenance could not parse the HEAD tree")
    entries.set(match[3].split(path.sep).join("/"), {
      mode: match[1],
      hash: match[2].toLowerCase(),
    })
  }
  return entries
}

function mapsEqual(left, right) {
  if (left.size !== right.size) return false
  for (const [filePath, value] of left) {
    const other = right.get(filePath)
    if (!other || other.mode !== value.mode || other.hash !== value.hash) return false
  }
  return true
}

function worktreeBlobHash(root, filePath, normalizeCrLf) {
  const absolutePath = path.join(root, ...filePath.split("/"))
  const stat = lstatSync(absolutePath)
  let contents
  if (stat.isSymbolicLink()) {
    contents = Buffer.from(readlinkSync(absolutePath))
  } else if (stat.isFile()) {
    contents = readFileSync(absolutePath)
  } else {
    throw new Error(`${filePath}: tracked source input is not a regular file or symlink`)
  }
  const rawHash = gitBlobHash(contents)
  if (!normalizeCrLf || contents.includes(0)) return [rawHash]
  const normalized = Buffer.from(contents.toString("binary").replaceAll("\r\n", "\n"), "binary")
  return rawHash === gitBlobHash(normalized) ? [rawHash] : [rawHash, gitBlobHash(normalized)]
}

export function readPackageSourceState(root, runner = spawnSync) {
  const sha = git(root, ["rev-parse", "--verify", "HEAD"], runner).trim()
  const tree = git(root, ["rev-parse", "--verify", "HEAD^{tree}"], runner).trim()
  const index = parseIndexEntries(git(root, ["ls-files", "-s", "-z"], runner))
  const head = parseHeadEntries(git(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], runner))
  const untrackedPaths = git(root, ["ls-files", "--others", "--exclude-standard", "-z"], runner)
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.split(path.sep).join("/"))
    .sort()
  const flags = git(root, ["ls-files", "-v", "-z"], runner).split("\0").filter(Boolean)
  const deceptiveIndexFlags = flags.filter(
    (entry) => entry[0] === "S" || entry[0] === entry[0]?.toLowerCase(),
  ).length
  const coreAutoCrLf = optionalGitConfig(root, "core.autocrlf", runner)
  const normalizeCrLf = coreAutoCrLf === "true" || coreAutoCrLf === "input"
  const indexMatchesHead = mapsEqual(index, head)
  let worktreeMatchesIndex = true
  for (const [filePath, entry] of index) {
    try {
      if (!worktreeBlobHash(root, filePath, normalizeCrLf).includes(entry.hash)) {
        worktreeMatchesIndex = false
      }
    } catch {
      worktreeMatchesIndex = false
    }
  }
  const sourcePaths = [...new Set([...index.keys(), ...untrackedPaths])].sort()
  if (!/^[a-f0-9]{40}$/i.test(sha) || !/^[a-f0-9]{40}$/i.test(tree)) {
    throw new Error("Package source provenance requires valid Git SHA and tree identities")
  }
  return {
    sha: sha.toLowerCase(),
    tree: tree.toLowerCase(),
    fingerprint: hashSourceFiles(root, sourcePaths),
    clean:
      indexMatchesHead &&
      worktreeMatchesIndex &&
      untrackedPaths.length === 0 &&
      deceptiveIndexFlags === 0,
    inputFiles: sourcePaths.length,
    indexMatchesHead,
    worktreeMatchesIndex,
    untrackedFiles: untrackedPaths.length,
    deceptiveIndexFlags,
  }
}

function provenancePayload(input) {
  return {
    schemaVersion: PACKAGE_PROVENANCE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    source: {
      sha: input.source.sha,
      tree: input.source.tree,
      fingerprint: input.source.fingerprint,
      clean: input.source.clean,
      ...(Number.isInteger(input.source.inputFiles) ? { inputFiles: input.source.inputFiles } : {}),
    },
    package: {
      version: input.version,
      productName: input.productName,
    },
    build: {
      channel: input.channel,
      platform: input.platform,
      architectures: [...input.architectures],
    },
  }
}

export function packageProvenanceDigest(provenance) {
  const { integrity: _integrity, ...payload } = provenance
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function createPackageProvenance(input) {
  const payload = provenancePayload(input)
  return {
    ...payload,
    integrity: {
      algorithm: "sha256",
      value: packageProvenanceDigest(payload),
    },
  }
}

export function writePackageProvenance(build, options = {}) {
  const root = options.root ?? process.cwd()
  const packageJson =
    options.packageJson ?? JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const source = options.source ?? readPackageSourceState(root, options.runner)
  if (build.channel === "release" && !source.clean) {
    throw new Error("Release packaging requires a clean exact-source checkout")
  }
  const provenance = createPackageProvenance({
    source,
    version: packageJson.version,
    productName: options.productName ?? packageJson.build.productName,
    channel: build.channel ?? "development",
    platform: build.platform,
    architectures: build.architectures,
    generatedAt: (options.now ?? new Date()).toISOString(),
  })
  const outputPath =
    options.outputPath ?? path.join(root, "build", "generated", "package-provenance.json")
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`)
  return { outputPath, provenance }
}
