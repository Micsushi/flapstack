import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const DEFAULT_STALE_AFTER_MS = 12 * 60 * 60 * 1000
const DEFAULT_INCOMPLETE_OWNER_GRACE_MS = 5_000

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

function safeOutputDirectory(root, outputDirectory) {
  const resolvedRoot = path.resolve(root)
  const resolvedOutput = path.resolve(outputDirectory)
  const relative = path.relative(resolvedRoot, resolvedOutput)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Package output must be a child of ${resolvedRoot}: ${resolvedOutput}`)
  }
  return resolvedOutput
}

function readOwner(lockPath) {
  try {
    const stat = fs.lstatSync(lockPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null
    return JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"))
  } catch {
    return null
  }
}

function removeLock(lockPath) {
  const stat = fs.lstatSync(lockPath)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe package lock path: ${lockPath}`)
  }
  fs.rmSync(lockPath, { recursive: true, force: true })
}

function sameOwner(left, right) {
  if (!left || !right) return false
  if (left.token || right.token) return left.token === right.token
  return (
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.outputDirectory === right.outputDirectory
  )
}

function reclaimStaleLock(lockPath, observedOwner) {
  const reclaimPath = `${lockPath}.reclaim`
  try {
    fs.mkdirSync(reclaimPath)
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Package lock reclamation is already in progress: ${lockPath}`)
    }
    throw error
  }

  try {
    const currentOwner = readOwner(lockPath)
    if (!sameOwner(currentOwner, observedOwner)) {
      throw new Error(`Package lock ownership changed during reclamation: ${lockPath}`)
    }
    fs.renameSync(lockPath, path.join(reclaimPath, "stale.lock"))
    try {
      fs.mkdirSync(lockPath)
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Package lock was acquired during reclamation: ${lockPath}`)
      }
      throw error
    }
  } finally {
    if (fs.existsSync(reclaimPath)) removeRealDirectory(reclaimPath, "package lock reclaim")
  }
}

function assertLockOwner(lockPath, owner) {
  if (!sameOwner(readOwner(lockPath), owner)) {
    throw new Error(`Package lock ownership changed before release: ${lockPath}`)
  }
}

function releaseLock(lockPath, owner) {
  assertLockOwner(lockPath, owner)
  removeLock(lockPath)
}

function assertRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe ${label}: ${directory}`)
  }
}

function removeRealDirectory(directory, label) {
  assertRealDirectory(directory, label)
  fs.rmSync(directory, { recursive: true, force: true })
}

function recoverPackageOutput(outputDirectory, stagingDirectory, backupDirectory) {
  if (fs.existsSync(stagingDirectory)) {
    removeRealDirectory(stagingDirectory, "package output staging directory")
  }
  const incompleteMarkerPath = path.join(outputDirectory, ".flapstack-package-incomplete")
  if (fs.existsSync(outputDirectory)) {
    assertRealDirectory(outputDirectory, "package output directory")
  }
  if (fs.existsSync(backupDirectory)) {
    assertRealDirectory(backupDirectory, "package output backup directory")
  }
  if (fs.existsSync(incompleteMarkerPath)) {
    const marker = fs.lstatSync(incompleteMarkerPath)
    if (!marker.isFile() || marker.isSymbolicLink()) {
      throw new Error(`Unsafe incomplete package marker: ${incompleteMarkerPath}`)
    }
    removeRealDirectory(outputDirectory, "interrupted package output directory")
  }
  if (!fs.existsSync(outputDirectory) && fs.existsSync(backupDirectory)) {
    fs.renameSync(backupDirectory, outputDirectory)
  } else if (fs.existsSync(outputDirectory) && fs.existsSync(backupDirectory)) {
    removeRealDirectory(backupDirectory, "completed package output backup directory")
  }
}

export function acquirePackageOutput(options) {
  const root = path.resolve(options.root)
  const outputDirectory = safeOutputDirectory(root, options.outputDirectory)
  const locksDirectory = path.join(root, "node_modules", ".flapstack-package-locks")
  const lockPath = path.join(locksDirectory, "package-app.lock")
  const incompleteMarkerPath = path.join(outputDirectory, ".flapstack-package-incomplete")
  const parent = path.dirname(outputDirectory)
  const outputName = path.basename(outputDirectory)
  const stagingDirectory = path.join(parent, `.${outputName}.package-staging`)
  const backupDirectory = path.join(parent, `.${outputName}.package-backup`)
  const pid = options.pid ?? process.pid
  const now = options.now ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const incompleteOwnerGraceMs = options.incompleteOwnerGraceMs ?? DEFAULT_INCOMPLETE_OWNER_GRACE_MS
  const isProcessAlive = options.isProcessAlive ?? processIsAlive
  const token = options.token ?? randomUUID()
  fs.mkdirSync(locksDirectory, { recursive: true })
  if (fs.existsSync(`${lockPath}.reclaim`)) {
    throw new Error(`Package lock reclamation is already in progress: ${lockPath}`)
  }

  try {
    fs.mkdirSync(lockPath)
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    const owner = readOwner(lockPath)
    const age =
      owner && Number.isFinite(owner.startedAt)
        ? now - owner.startedAt
        : now - fs.lstatSync(lockPath).mtimeMs
    if (owner && age < staleAfterMs && isProcessAlive(owner.pid)) {
      throw new Error(`Packaging ${outputDirectory} is already in progress under PID ${owner.pid}`)
    }
    if (!owner && age < incompleteOwnerGraceMs) {
      throw new Error(
        `Packaging ${outputDirectory} is already in progress under an owner that is still starting`,
      )
    }
    reclaimStaleLock(lockPath, owner)
  }

  const owner = { pid, startedAt: now, outputDirectory, token }
  fs.writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, {
    flag: "wx",
    mode: 0o600,
  })

  try {
    recoverPackageOutput(outputDirectory, stagingDirectory, backupDirectory)
    fs.mkdirSync(stagingDirectory)
    fs.writeFileSync(
      path.join(stagingDirectory, ".flapstack-package-incomplete"),
      `${JSON.stringify(owner)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    )
    if (fs.existsSync(outputDirectory)) {
      assertRealDirectory(outputDirectory, "previous package output directory")
      fs.renameSync(outputDirectory, backupDirectory)
    }
    fs.renameSync(stagingDirectory, outputDirectory)
  } catch (error) {
    if (fs.existsSync(stagingDirectory)) {
      removeRealDirectory(stagingDirectory, "failed package output staging directory")
    }
    if (!fs.existsSync(outputDirectory) && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, outputDirectory)
    }
    if (fs.existsSync(lockPath) && sameOwner(readOwner(lockPath), owner)) {
      removeLock(lockPath)
    }
    throw error
  }
  return {
    lockPath,
    incompleteMarkerPath,
    outputDirectory,
    backupDirectory,
    stagingDirectory,
    owner,
  }
}

export function completePackageOutput(handle) {
  assertLockOwner(handle.lockPath, handle.owner)
  fs.rmSync(handle.incompleteMarkerPath, { force: true })
  if (fs.existsSync(handle.backupDirectory)) {
    removeRealDirectory(handle.backupDirectory, "previous package output backup directory")
  }
  releaseLock(handle.lockPath, handle.owner)
}

export function failPackageOutput(handle) {
  assertLockOwner(handle.lockPath, handle.owner)
  fs.mkdirSync(handle.outputDirectory, { recursive: true })
  if (!fs.existsSync(handle.incompleteMarkerPath)) {
    fs.writeFileSync(handle.incompleteMarkerPath, `${JSON.stringify(handle.owner)}\n`, {
      flag: "wx",
      mode: 0o600,
    })
  }
  releaseLock(handle.lockPath, handle.owner)
}
