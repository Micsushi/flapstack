import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs"
import path from "node:path"

const MACHO_CPU_TYPES = new Map([
  [0x01000007, "x64"],
  [0x0100000c, "arm64"],
])

const ELF_MACHINE_TYPES = new Map([
  [62, "x64"],
  [183, "arm64"],
])

const PE_MACHINE_TYPES = new Map([
  [0x8664, "x64"],
  [0xaa64, "arm64"],
])

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
    stream.on("error", reject)
  })
}

function readPrefix(filePath, size = 4096) {
  const fd = openSync(filePath, "r")
  try {
    const buffer = Buffer.alloc(size)
    const bytesRead = readSync(fd, buffer, 0, size, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    closeSync(fd)
  }
}

function machoCpuType(buffer, offset, littleEndian) {
  const value = littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
  return MACHO_CPU_TYPES.get(value)
}

function inspectMachO(buffer) {
  if (buffer.length < 8) return null
  const magic = buffer.readUInt32BE(0)
  if (magic === 0xfeedface || magic === 0xfeedfacf) {
    return { format: "mach-o", architectures: [machoCpuType(buffer, 4, false)].filter(Boolean) }
  }
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return { format: "mach-o", architectures: [machoCpuType(buffer, 4, true)].filter(Boolean) }
  }
  if (magic !== 0xcafebabe && magic !== 0xbebafeca) return null

  const littleEndian = magic === 0xbebafeca
  const readU32 = (offset) =>
    littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
  const count = readU32(4)
  const architectures = []
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 20
    if (offset + 4 > buffer.length) break
    const architecture = MACHO_CPU_TYPES.get(readU32(offset))
    if (architecture) architectures.push(architecture)
  }
  return { format: "mach-o-fat", architectures }
}

function inspectElf(buffer) {
  if (buffer.length < 20 || !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return null
  }
  const littleEndian = buffer[5] === 1
  const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
  return { format: "elf", architectures: [ELF_MACHINE_TYPES.get(machine)].filter(Boolean) }
}

function inspectPe(buffer) {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null
  const peOffset = buffer.readUInt32LE(0x3c)
  if (
    peOffset + 6 > buffer.length ||
    buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  ) {
    return null
  }
  return {
    format: "pe",
    architectures: [PE_MACHINE_TYPES.get(buffer.readUInt16LE(peOffset + 4))].filter(Boolean),
  }
}

export function inspectBinaryArchitecture(filePath) {
  const buffer = readPrefix(filePath)
  return (
    inspectMachO(buffer) ??
    inspectElf(buffer) ??
    inspectPe(buffer) ?? {
      format: "unknown",
      architectures: [],
    }
  )
}

export function validateBundledBinary(filePath, platformKey, options = {}) {
  const [expectedPlatform, expectedArch] = platformKey.split("-")
  const requireExecutable = options.requireExecutable ?? !platformKey.startsWith("win32-")
  const errors = []
  let stat
  try {
    stat = lstatSync(filePath)
  } catch (error) {
    return {
      ok: false,
      errors: [`missing: ${error instanceof Error ? error.message : String(error)}`],
      format: "unknown",
      architectures: [],
    }
  }

  if (stat.isSymbolicLink()) errors.push("must be a regular file, not a symlink")
  if (!stat.isFile()) errors.push("must be a regular file")
  if (requireExecutable && (stat.mode & 0o111) === 0) errors.push("must be executable")

  let inspection = { format: "unknown", architectures: [] }
  if (stat.isFile()) {
    try {
      inspection = inspectBinaryArchitecture(filePath)
    } catch (error) {
      errors.push(
        `architecture inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (inspection.architectures.length === 0) {
    errors.push(`unrecognized ${platformKey} binary format`)
  } else if (!inspection.architectures.includes(expectedArch)) {
    errors.push(
      `wrong architecture: expected ${expectedArch}, found ${inspection.architectures.join(", ")}`,
    )
  }
  const expectedFormats = {
    darwin: ["mach-o", "mach-o-fat"],
    linux: ["elf"],
    win32: ["pe"],
  }[expectedPlatform]
  if (
    expectedFormats &&
    inspection.format !== "unknown" &&
    !expectedFormats.includes(inspection.format)
  ) {
    errors.push(
      `wrong binary format: expected ${expectedFormats.join(" or ")}, found ${inspection.format}`,
    )
  }

  return { ok: errors.length === 0, errors, ...inspection }
}

export function assertBundledBinary(filePath, platformKey, options = {}) {
  const result = validateBundledBinary(filePath, platformKey, options)
  if (!result.ok) throw new Error(`${filePath}: ${result.errors.join("; ")}`)
  return result
}

export async function verifyCachedBinaryDigest(filePath, platformKey, markerPath) {
  try {
    assertBundledBinary(filePath, platformKey)
    const marker = readFileSync(markerPath, "utf8").trim().toLowerCase()
    return /^[a-f0-9]{64}$/.test(marker) && (await sha256File(filePath)) === marker
  } catch {
    return false
  }
}

export function ensureRealDirectory(directory) {
  mkdirSync(path.dirname(directory), { recursive: true })
  try {
    const stat = lstatSync(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${directory}: must be a real directory, not a symlink or non-directory`)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    mkdirSync(directory)
  }
}

export function assertAllowlistedRegularFiles(
  directory,
  requiredFiles,
  allowedFiles = requiredFiles,
) {
  const stat = lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${directory}: must be a real directory`)
  }
  const required = new Set(requiredFiles)
  const allowed = new Set(allowedFiles)
  const entries = readdirSync(directory)
  const unexpected = entries.filter((entry) => !allowed.has(entry))
  const missing = [...required].filter((entry) => !entries.includes(entry))
  if (unexpected.length > 0) {
    throw new Error(`${directory}: unexpected packaged resources: ${unexpected.sort().join(", ")}`)
  }
  if (missing.length > 0) {
    throw new Error(`${directory}: missing packaged resources: ${missing.sort().join(", ")}`)
  }
  for (const entry of entries) {
    const entryStat = lstatSync(path.join(directory, entry))
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      throw new Error(`${path.join(directory, entry)}: must be a regular file, not a symlink`)
    }
  }
  return entries.sort()
}

export function replaceDirectoryAtomically(stagingDirectory, targetDirectory) {
  const stagingStat = lstatSync(stagingDirectory)
  if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error(`${stagingDirectory}: staging path must be a real directory`)
  }
  const parent = path.dirname(targetDirectory)
  if (path.dirname(stagingDirectory) !== parent) {
    throw new Error("Staging directory must be beside its target for an atomic rename")
  }
  ensureRealDirectory(parent)
  const backup = path.join(parent, `.${path.basename(targetDirectory)}.backup-${randomUUID()}`)
  let previousMoved = false
  try {
    lstatSync(targetDirectory)
    renameSync(targetDirectory, backup)
    previousMoved = true
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  try {
    renameSync(stagingDirectory, targetDirectory)
  } catch (error) {
    if (previousMoved) renameSync(backup, targetDirectory)
    throw error
  }
  if (previousMoved) rmSync(backup, { recursive: true, force: true })
}
