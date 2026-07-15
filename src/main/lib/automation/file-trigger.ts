import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import { isAbsolute, relative, resolve, sep, win32 } from "node:path"
import type { ChokidarOptions, FSWatcher } from "chokidar"
import { DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES } from "../../../shared/automation"
import {
  assertRegisteredWorktree,
  type RegisteredFilesystemRoot,
} from "../git/security/path-validation"

const MAX_CHANGED_PATHS = 500
const FILE_EVENTS = new Set(["add", "change", "unlink"])

export interface AutomationFileTriggerConfig {
  triggerId: string
  automationId: string
  rootPath: string
  includeGlobs: string[]
  excludeGlobs?: string[]
  debounceMs: number
}

export interface AutomationFileTriggerOccurrence {
  automationId: string
  triggerId: string
  dedupeKey: string
  scheduledFor: number
  payload: {
    source: "file-change"
    rootPath: string
    changedPaths: string[]
    truncated: boolean
  }
}

export interface AutomationFileTriggerWatchAdapter {
  on(event: "all", listener: (eventName: string, changedPath: string) => void): this
  on(event: "error", listener: (error: unknown) => void): this
  close(): Promise<void>
}

export type AutomationFileTriggerWatchFactory = (
  rootPath: string,
  options: ChokidarOptions,
) => AutomationFileTriggerWatchAdapter

export interface AutomationFileTriggerTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface AutomationFileTriggerServiceOptions {
  enqueueOccurrence: (occurrence: AutomationFileTriggerOccurrence) => void | Promise<void>
  resolveRegisteredRoot?: (rootPath: string) => RegisteredFilesystemRoot
  watchFactory?: AutomationFileTriggerWatchFactory
  timers?: AutomationFileTriggerTimers
  now?: () => number
  createDedupeId?: () => string
  onError?: (error: Error) => void
}

interface CompiledTrigger extends AutomationFileTriggerConfig {
  canonicalRoot: string
  includes: RegExp[]
  excludes: RegExp[]
}

interface RootWatch {
  generation: number
  registration: RegisteredFilesystemRoot
  triggers: CompiledTrigger[]
  watcher: AutomationFileTriggerWatchAdapter
  closed: boolean
}

interface PendingBatch {
  trigger: CompiledTrigger
  paths: Set<string>
  truncated: boolean
  timer: unknown | null
}

const systemTimers: AutomationFileTriggerTimers = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export class AutomationFileTriggerService {
  private readonly resolveRegisteredRoot: (rootPath: string) => RegisteredFilesystemRoot
  private readonly timers: AutomationFileTriggerTimers
  private readonly now: () => number
  private readonly createDedupeId: () => string
  private roots = new Map<string, RootWatch>()
  private pending = new Map<string, PendingBatch>()
  private flushes = new Set<Promise<void>>()
  private generation = 0

  constructor(private readonly options: AutomationFileTriggerServiceOptions) {
    this.resolveRegisteredRoot = options.resolveRegisteredRoot ?? assertRegisteredWorktree
    this.timers = options.timers ?? systemTimers
    this.now = options.now ?? Date.now
    this.createDedupeId = options.createDedupeId ?? randomUUID
  }

  async replaceTriggers(configs: AutomationFileTriggerConfig[]): Promise<void> {
    const generation = ++this.generation
    await this.closeRootsAndBatches()

    const grouped = new Map<
      string,
      { registration: RegisteredFilesystemRoot; triggers: CompiledTrigger[] }
    >()
    for (const config of configs) {
      const trigger = this.compileTrigger(config)
      const existing = grouped.get(trigger.canonicalRoot)
      if (existing) existing.triggers.push(trigger)
      else {
        grouped.set(trigger.canonicalRoot, {
          registration: this.resolveRegisteredRoot(config.rootPath),
          triggers: [trigger],
        })
      }
    }

    const watchFactory = this.options.watchFactory ?? (await defaultWatchFactory())
    try {
      for (const [canonicalRoot, group] of grouped) {
        const watcher = watchFactory(canonicalRoot, {
          persistent: true,
          ignoreInitial: true,
          followSymlinks: false,
          ignored: createDefaultIgnoreMatcher(canonicalRoot),
        })
        const rootWatch: RootWatch = {
          generation,
          registration: group.registration,
          triggers: group.triggers,
          watcher,
          closed: false,
        }
        this.roots.set(canonicalRoot, rootWatch)
        watcher.on("all", (eventName, changedPath) => {
          this.handleEvent(rootWatch, eventName, changedPath)
        })
        watcher.on("error", (error) => this.reportError(error))
      }
    } catch (error) {
      await this.closeRootsAndBatches()
      throw error
    }
  }

  async restart(configs: AutomationFileTriggerConfig[]): Promise<void> {
    await this.replaceTriggers(configs)
  }

  async stop(): Promise<void> {
    ++this.generation
    await this.closeRootsAndBatches()
    await Promise.all([...this.flushes])
  }

  getWatcherCount(): number {
    return this.roots.size
  }

  private compileTrigger(config: AutomationFileTriggerConfig): CompiledTrigger {
    if (!config.triggerId.trim() || !config.automationId.trim()) {
      throw new Error("Automation file trigger and automation IDs are required.")
    }
    if (
      !Number.isSafeInteger(config.debounceMs) ||
      config.debounceMs < 100 ||
      config.debounceMs > 60_000
    ) {
      throw new Error("Automation file trigger debounce must be between 100 and 60000 ms.")
    }
    if (config.includeGlobs.length === 0 || config.includeGlobs.length > 100) {
      throw new Error("Automation file trigger requires 1 to 100 include globs.")
    }
    const customExcludes = config.excludeGlobs ?? []
    if (customExcludes.length > 100) {
      throw new Error("Automation file trigger supports at most 100 exclude globs.")
    }
    const excludes = [...new Set([...DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES, ...customExcludes])]
    const registration = this.resolveRegisteredRoot(config.rootPath)
    return {
      ...config,
      excludeGlobs: excludes,
      canonicalRoot: registration.canonicalPath,
      includes: config.includeGlobs.map(compileGlob),
      excludes: excludes.map(compileGlob),
    }
  }

  private handleEvent(rootWatch: RootWatch, eventName: string, changedPath: string): void {
    if (
      rootWatch.closed ||
      rootWatch.generation !== this.generation ||
      !FILE_EVENTS.has(eventName)
    ) {
      return
    }

    let registration: RegisteredFilesystemRoot
    try {
      registration = this.resolveRegisteredRoot(rootWatch.registration.path)
      if (registration.canonicalPath !== rootWatch.registration.canonicalPath) {
        throw new Error("Registered automation file-trigger root changed identity.")
      }
    } catch (error) {
      void this.disableRoot(rootWatch, error)
      return
    }

    const relativePath = safeRelativeEventPath(registration, changedPath)
    if (relativePath === null) return

    for (const trigger of rootWatch.triggers) {
      if (
        !matchesAny(relativePath, trigger.includes) ||
        matchesAny(relativePath, trigger.excludes)
      ) {
        continue
      }
      this.addToBatch(trigger, relativePath)
    }
  }

  private addToBatch(trigger: CompiledTrigger, relativePath: string): void {
    const key = `${trigger.automationId}\0${trigger.canonicalRoot}`
    let batch = this.pending.get(key)
    if (!batch) {
      batch = {
        trigger,
        paths: new Set(),
        truncated: false,
        timer: null,
      }
      this.pending.set(key, batch)
    }
    if (batch.paths.size < MAX_CHANGED_PATHS) batch.paths.add(relativePath)
    else if (!batch.paths.has(relativePath)) batch.truncated = true

    if (batch.timer !== null) this.timers.clearTimeout(batch.timer)
    batch.timer = this.timers.setTimeout(
      () => this.flushBatch(key, batch!),
      batch.trigger.debounceMs,
    )
  }

  private flushBatch(key: string, batch: PendingBatch): void {
    if (this.pending.get(key) !== batch) return
    this.pending.delete(key)
    const scheduledFor = this.now()
    const occurrence: AutomationFileTriggerOccurrence = {
      automationId: batch.trigger.automationId,
      triggerId: batch.trigger.triggerId,
      dedupeKey: `file-change:${batch.trigger.triggerId}:${this.createDedupeId()}`,
      scheduledFor,
      payload: {
        source: "file-change",
        rootPath: batch.trigger.rootPath,
        changedPaths: [...batch.paths].sort(),
        truncated: batch.truncated,
      },
    }
    const flush = Promise.resolve()
      .then(() => this.options.enqueueOccurrence(occurrence))
      .catch((error) => this.reportError(error))
      .finally(() => this.flushes.delete(flush))
    this.flushes.add(flush)
  }

  private async disableRoot(rootWatch: RootWatch, error: unknown): Promise<void> {
    if (rootWatch.closed) return
    rootWatch.closed = true
    this.roots.delete(rootWatch.registration.canonicalPath)
    this.clearBatchesForRoot(rootWatch.registration.canonicalPath)
    await rootWatch.watcher.close().catch((closeError) => this.reportError(closeError))
    this.reportError(error)
  }

  private clearBatchesForRoot(canonicalRoot: string): void {
    for (const [key, batch] of this.pending) {
      if (batch.trigger.canonicalRoot !== canonicalRoot) continue
      this.timers.clearTimeout(batch.timer)
      this.pending.delete(key)
    }
  }

  private async closeRootsAndBatches(): Promise<void> {
    for (const batch of this.pending.values()) this.timers.clearTimeout(batch.timer)
    this.pending.clear()
    const roots = [...this.roots.values()]
    this.roots.clear()
    for (const root of roots) root.closed = true
    await Promise.all(
      roots.map((root) => root.watcher.close().catch((error) => this.reportError(error))),
    )
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}

export function createDatabaseAutomationFileTriggerEnqueuer(
  databasePath: string,
  createId: () => string = randomUUID,
): (occurrence: AutomationFileTriggerOccurrence) => boolean {
  return (occurrence) => {
    const database = openAppDatabase(databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      const inserted = database
        .prepare(
          `INSERT OR IGNORE INTO automation_occurrences (
             id, automation_id, trigger_id, dedupe_key, state,
             scheduled_for, payload, created_at
           ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          createId(),
          occurrence.automationId,
          occurrence.triggerId,
          occurrence.dedupeKey,
          occurrence.scheduledFor,
          JSON.stringify(occurrence.payload),
          occurrence.scheduledFor,
        )
      return inserted.changes === 1
    } finally {
      database.close()
    }
  }
}

function safeRelativeEventPath(
  registration: RegisteredFilesystemRoot,
  changedPath: string,
): string | null {
  if (!changedPath || changedPath.includes("\0")) return null
  const absoluteEvent = isAbsolute(changedPath) || win32.isAbsolute(changedPath)
  let relativeCandidate = changedPath
  if (absoluteEvent) {
    relativeCandidate = relative(registration.canonicalPath, resolve(changedPath))
    if (escapesRoot(relativeCandidate)) {
      relativeCandidate = relative(resolve(registration.path), resolve(changedPath))
    }
  }
  const segments = relativeCandidate.split(/[\\/]+/)
  if (
    relativeCandidate === "" ||
    isAbsolute(relativeCandidate) ||
    win32.isAbsolute(relativeCandidate) ||
    segments.some((segment) => segment === "" || segment === "..")
  ) {
    return null
  }
  const absolutePath = resolve(registration.canonicalPath, ...segments)
  const bounded = relative(registration.canonicalPath, absolutePath)
  if (bounded === "" || escapesRoot(bounded)) {
    return null
  }
  if (containsSymlink(registration.canonicalPath, segments)) return null
  return segments.join("/")
}

function escapesRoot(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath)
  )
}

function containsSymlink(rootPath: string, segments: string[]): boolean {
  let current = rootPath
  for (const segment of segments) {
    current = resolve(current, segment)
    try {
      if (lstatSync(current).isSymbolicLink()) return true
    } catch (error) {
      if (isMissingPath(error)) return false
      return true
    }
  }
  return false
}

function isMissingPath(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR"),
  )
}

function matchesAny(relativePath: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(relativePath))
}

function createDefaultIgnoreMatcher(rootPath: string): (watchedPath: string) => boolean {
  const patterns = DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES.map(compileGlob)
  return (watchedPath) => {
    const relativePath = relative(rootPath, watchedPath).split(sep).join("/")
    if (!relativePath || escapesRoot(relativePath)) return false
    return matchesAny(relativePath, patterns) || matchesAny(`${relativePath}/_`, patterns)
  }
}

function compileGlob(pattern: string): RegExp {
  const normalized = pattern.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    win32.isAbsolute(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Automation file-trigger glob must stay relative: ${pattern}`)
  }
  return new RegExp(`^(?:${compileGlobFragment(normalized)})$`)
}

function compileGlobFragment(pattern: string): string {
  let result = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1
        if (pattern[index + 1] === "/") {
          index += 1
          result += "(?:.*/)?"
        } else result += ".*"
      } else result += "[^/]*"
      continue
    }
    if (character === "?") {
      result += "[^/]"
      continue
    }
    if (character === "{") {
      const close = pattern.indexOf("}", index + 1)
      if (close !== -1) {
        const alternatives = pattern.slice(index + 1, close).split(",")
        if (alternatives.every(Boolean)) {
          result += `(?:${alternatives.map(compileGlobFragment).join("|")})`
          index = close
          continue
        }
      }
    }
    result += escapeRegex(character)
  }
  return result
}

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character
}

async function defaultWatchFactory(): Promise<AutomationFileTriggerWatchFactory> {
  const { watch } = await import("chokidar")
  return (rootPath, options) => watch(rootPath, options) as FSWatcher
}
