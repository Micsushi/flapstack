import Database from "better-sqlite3"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const DRAIN_TIMEOUT_MS = 30_000
const MARKER_BYTES = 4_096
const PROCESS_NONCE = randomUUID()
const PROCESS_START_IDENTITY = readProcessStartIdentity(process.pid)
const localMaintenancePaths = new Set<string>()
let configuredDatabasePath: string | null = null
let databaseAccessTestHooks: DatabaseAccessTestHooks | null = null

export type DatabaseAccessTestHooks = {
  beforeMarkerQuarantine?: (path: string, kind: AccessMarker["kind"]) => void
}

type AccessMarker = {
  schemaVersion: 1
  kind: "access" | "owner"
  pid: number
  processNonce: string
  processStartIdentity: string | null
  owner?: string
}

type AccessMarkerBinding = {
  marker: AccessMarker
  deviceId: string
  inodeId: string
}

export type DatabaseMaintenanceAccessLease = {
  waitForDrain(): Promise<void>
  release(): void
}

export function setDatabaseAccessTestHooks(hooks: DatabaseAccessTestHooks | null): void {
  databaseAccessTestHooks = hooks
}

export function openAppDatabase(
  databasePath: string,
  options?: Database.Options,
): Database.Database {
  databasePath = canonicalDatabasePath(databasePath)
  const releaseAccess = acquireAppDatabaseOperation(databasePath)
  let sqlite: Database.Database
  try {
    sqlite = new Database(databasePath, options)
  } catch (error) {
    releaseAccess()
    throw error
  }
  const close = sqlite.close.bind(sqlite)
  let closed = false
  Object.defineProperty(sqlite, "close", {
    configurable: true,
    value: () => {
      if (closed) return
      closed = true
      try {
        close()
      } finally {
        releaseAccess()
      }
    },
  })
  return sqlite
}

export function configureAppDatabasePath(databasePath: string): void {
  configuredDatabasePath = canonicalDatabasePath(databasePath)
}

export function acquireConfiguredAppDatabaseOperation(): () => void {
  return configuredDatabasePath ? acquireAppDatabaseOperation(configuredDatabasePath) : () => {}
}

export function acquireAppDatabaseOperation(databasePath: string): () => void {
  databasePath = canonicalDatabasePath(databasePath)
  assertNoLiveMaintenanceOwner(databasePath)
  const root = accessRoot(databasePath)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const markerPath = join(root, `${process.pid}-${PROCESS_NONCE}-${randomUUID()}.json`)
  const markerBinding = writeMarker(markerPath, {
    schemaVersion: 1,
    kind: "access",
    ...processIdentity(),
  })
  try {
    assertNoLiveMaintenanceOwner(databasePath)
  } catch (error) {
    removeUnchangedMarker(markerPath, markerBinding)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    removeUnchangedMarker(markerPath, markerBinding)
  }
}

export function beginDatabaseAccessMaintenance(
  databasePath: string,
  owner: string,
): DatabaseMaintenanceAccessLease {
  databasePath = canonicalDatabasePath(databasePath)
  const ownerPath = maintenanceOwnerPath(databasePath)
  assertNoLiveMaintenanceOwner(databasePath)
  try {
    const ownerBinding = writeMarker(ownerPath, {
      schemaVersion: 1,
      kind: "owner",
      ...processIdentity(),
      owner,
    })
    localMaintenancePaths.add(databasePath)
    let released = false
    return {
      waitForDrain: async () => {
        const deadline = Date.now() + DRAIN_TIMEOUT_MS
        while (activeAccessMarkers(databasePath).length > 0) {
          if (Date.now() >= deadline)
            throw new Error("Timed out draining active database readers and writers.")
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
        }
      },
      release: () => {
        if (released) return
        removeUnchangedMarker(ownerPath, ownerBinding)
        released = true
        localMaintenancePaths.delete(databasePath)
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Database maintenance access lease is already active.")
    throw error
  }
}

export function canonicalDatabasePath(databasePath: string): string {
  const absolute = resolve(databasePath)
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 })
  try {
    return realpathSync.native(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return join(realpathSync.native(dirname(absolute)), basename(absolute))
  }
}

function assertNoLiveMaintenanceOwner(databasePath: string): void {
  if (localMaintenancePaths.has(databasePath))
    throw new Error("Database is paused for bounded maintenance.")
  // Scan twice around the fixed path. A release atomically moving the fixed
  // marker into quarantine is visible in at least one half of each pass.
  for (let pass = 0; pass < 2; pass += 1) {
    const ownerPaths = quarantineMarkerPaths(databasePath, "owner")
    const ownerPath = maintenanceOwnerPath(databasePath)
    if (existsSync(ownerPath)) ownerPaths.push(ownerPath)
    for (const path of ownerPaths) {
      const binding = readMarker(path, "owner")
      if (isProcessProvablyDead(binding.marker)) removeUnchangedMarker(path, binding)
      else throw new Error("Database is paused for bounded maintenance.")
    }
  }
}

function activeAccessMarkers(databasePath: string): string[] {
  const root = accessRoot(databasePath)
  const live: string[] = []
  for (let pass = 0; pass < 2; pass += 1) {
    const markerPaths = [
      ...directoryMarkerPaths(root),
      ...quarantineMarkerPaths(databasePath, "access"),
    ]
    for (const markerPath of markerPaths) {
      if (live.includes(markerPath)) continue
      const binding = readMarker(markerPath, "access")
      if (isProcessProvablyDead(binding.marker)) removeUnchangedMarker(markerPath, binding)
      else live.push(markerPath)
    }
  }
  return live
}

function readMarker(path: string, expectedKind: AccessMarker["kind"]): AccessMarkerBinding {
  const before = lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MARKER_BYTES))
    throw new Error("Database access marker is invalid.")
  let descriptor: number | null = null
  let contents: Buffer
  let opened: ReturnType<typeof fstatSync>
  let after: ReturnType<typeof fstatSync>
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    opened = fstatSync(descriptor, { bigint: true })
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.size > BigInt(MARKER_BYTES)
    )
      throw new Error("Database access marker changed while opening.")
    contents = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < contents.length) {
      const bytesRead = readSync(descriptor, contents, offset, contents.length - offset, offset)
      if (bytesRead === 0) throw new Error("Database access marker changed while reading.")
      offset += bytesRead
    }
    after = fstatSync(descriptor, { bigint: true })
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
  if (
    opened.dev !== after.dev ||
    opened.ino !== after.ino ||
    opened.size !== after.size ||
    opened.mtimeMs !== after.mtimeMs
  )
    throw new Error("Database access marker changed while reading.")
  let parsed: unknown
  try {
    parsed = JSON.parse(contents.toString("utf8"))
  } catch {
    throw new Error("Database access marker is invalid.")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Database access marker is invalid.")
  const value = parsed as Record<string, unknown>
  const expectedKeys =
    expectedKind === "owner"
      ? ["kind", "owner", "pid", "processNonce", "processStartIdentity", "schemaVersion"]
      : ["kind", "pid", "processNonce", "processStartIdentity", "schemaVersion"]
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    value.schemaVersion !== 1 ||
    value.kind !== expectedKind ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.processNonce !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.processNonce) ||
    (value.processStartIdentity !== null && typeof value.processStartIdentity !== "string") ||
    (expectedKind === "owner" &&
      (typeof value.owner !== "string" || !value.owner || value.owner.length > 200))
  )
    throw new Error("Database access marker is invalid.")
  return {
    marker: value as AccessMarker,
    deviceId: opened.dev.toString(),
    inodeId: opened.ino.toString(),
  }
}

function removeUnchangedMarker(path: string, expected: AccessMarkerBinding): void {
  const current = readMarker(path, expected.marker.kind)
  if (
    current.deviceId !== expected.deviceId ||
    current.inodeId !== expected.inodeId ||
    JSON.stringify(current.marker) !== JSON.stringify(expected.marker)
  )
    throw new Error("Database access marker changed before orphan cleanup.")
  databaseAccessTestHooks?.beforeMarkerQuarantine?.(path, expected.marker.kind)
  const quarantineRoot = markerQuarantineRoot(path, expected.marker.kind)
  mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 })
  const quarantinePath = join(quarantineRoot, `${randomUUID()}.json`)
  renameSync(path, quarantinePath)
  const quarantined = readMarker(quarantinePath, expected.marker.kind)
  if (
    quarantined.deviceId !== expected.deviceId ||
    quarantined.inodeId !== expected.inodeId ||
    JSON.stringify(quarantined.marker) !== JSON.stringify(expected.marker)
  )
    throw new Error("Database access marker changed before atomic quarantine cleanup.")
  // The quarantine directory is app-private and this unguessable entry was
  // atomically bound above. A replacement at the shared marker path is never
  // unlinked. Mismatched quarantine entries remain visible to lease scans.
  rmSync(quarantinePath)
}

function isProcessProvablyDead(marker: AccessMarker): boolean {
  if (marker.pid === process.pid && marker.processNonce === PROCESS_NONCE) return false
  try {
    process.kill(marker.pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
  }
  const currentStartIdentity = readProcessStartIdentity(marker.pid)
  return Boolean(
    marker.processStartIdentity &&
    currentStartIdentity &&
    marker.processStartIdentity !== currentStartIdentity,
  )
}

function readProcessStartIdentity(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", timeout: 2_000 },
      ).trim()
    }
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim()
  } catch {
    return null
  }
}

function processIdentity(): Pick<AccessMarker, "pid" | "processNonce" | "processStartIdentity"> {
  return {
    pid: process.pid,
    processNonce: PROCESS_NONCE,
    processStartIdentity: PROCESS_START_IDENTITY,
  }
}

function writeMarker(path: string, marker: AccessMarker): AccessMarkerBinding {
  writeFileSync(path, `${JSON.stringify(marker)}\n`, { flag: "wx", mode: 0o600 })
  const binding = readMarker(path, marker.kind)
  if (JSON.stringify(binding.marker) !== JSON.stringify(marker))
    throw new Error("Database access marker changed while creating the lease.")
  return binding
}

function directoryMarkerPaths(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return entries.map((entry) => {
    if (!entry.endsWith(".json"))
      throw new Error("Database access marker directory contains an invalid entry.")
    return join(root, entry)
  })
}

function quarantineMarkerPaths(databasePath: string, kind: AccessMarker["kind"]): string[] {
  return directoryMarkerPaths(markerQuarantineRoot(databasePath, kind))
}

function markerQuarantineRoot(markerOrDatabasePath: string, kind: AccessMarker["kind"]): string {
  let databasePath = markerOrDatabasePath
  if (databasePath.endsWith(".flapstack-maintenance")) {
    databasePath = databasePath.slice(0, -".flapstack-maintenance".length)
  } else {
    const parent = dirname(databasePath)
    if (parent.endsWith(".flapstack-access")) {
      databasePath = parent.slice(0, -".flapstack-access".length)
    } else {
      const quarantineRoot = dirname(parent)
      if (quarantineRoot.endsWith(".flapstack-marker-quarantine"))
        databasePath = quarantineRoot.slice(0, -".flapstack-marker-quarantine".length)
    }
  }
  return `${databasePath}.flapstack-marker-quarantine/${kind}`
}

function accessRoot(databasePath: string): string {
  return `${databasePath}.flapstack-access`
}

function maintenanceOwnerPath(databasePath: string): string {
  return `${databasePath}.flapstack-maintenance`
}
