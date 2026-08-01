import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import {
  chatWorkbenchLayoutSchema,
  chatWorkbenchSessionPresentationSchema,
  createChatWorkbenchLayout,
  type ChatWorkbenchLayout,
  type ChatWorkbenchSessionPresentation,
} from "../../shared/chat-workbench"
import type {
  WorkbenchWindowCreationFailure,
  WorkbenchWindowCreationFailureReason,
  WorkbenchWindowDestination,
  WorkbenchWindowKind,
  WorkbenchWindowState,
} from "../../shared/workbench-window-budget"

export type {
  WorkbenchWindowDestination,
  WorkbenchWindowKind,
  WorkbenchWindowState,
} from "../../shared/workbench-window-budget"

export const MAX_WORKBENCH_WINDOWS = 4
const DEFAULT_RESERVATION_TTL_MS = 15_000
const MAX_EXPIRED_RESERVATION_TOMBSTONES = 128

export type WindowClassification =
  "workbench" | "dialog" | "native-picker" | "capture-overlay" | "hidden-utility"

interface WorkbenchWindowCounts {
  maximum: typeof MAX_WORKBENCH_WINDOWS
  liveCount: number
  reservedCount: number
  availableSlots: number
  expiredReservationCount: number
  destinations: WorkbenchWindowDestination[]
}

export type WorkbenchWindowReservationResult =
  | (WorkbenchWindowCounts & {
      status: "available"
      counted: boolean
      reservationId: string | null
      expiresAt: number | null
    })
  | (WorkbenchWindowCounts & {
      status: "at-limit"
      counted: false
      reservationId: null
      expiresAt: null
    })
  | (WorkbenchWindowCounts & {
      status: "stable-id-conflict"
      counted: false
      reservationId: null
      expiresAt: null
      stableId: string
    })

export type WorkbenchWindowCommitResult =
  | (WorkbenchWindowCounts & { status: "available"; stableId: string })
  | (WorkbenchWindowCounts & { status: "reservation-expired" })
  | (WorkbenchWindowCounts & {
      status: "stable-id-mismatch"
      requestedStableId: string
      actualStableId: string
    })
  | (WorkbenchWindowCounts & { status: "stable-id-conflict"; stableId: string })

export type WorkbenchWindowInspection =
  | (WorkbenchWindowCounts & { status: "available" })
  | (WorkbenchWindowCounts & { status: "at-limit" })

export interface WorkbenchWindowMetadata {
  stableId: string
  kind: WorkbenchWindowKind
  hasProject: boolean
  hasChat: boolean
}

interface Reservation {
  expiresAt: number
  requestedStableId?: string
}

interface LiveWindow extends WorkbenchWindowMetadata {
  state: WorkbenchWindowState
  lastFocusedAt: number
}

export interface RestorableWindow {
  stableId: string
  lastFocusedAt: number
  valid: boolean
}

export class WindowBudget {
  private readonly now: () => number
  private readonly reservationTtlMs: number
  private readonly reservations = new Map<string, Reservation>()
  private readonly expiredReservations = new Set<string>()
  private readonly live = new Map<string, LiveWindow>()
  private nextReservation = 1

  constructor(options?: { now?: () => number; reservationTtlMs?: number }) {
    this.now = options?.now ?? Date.now
    this.reservationTtlMs = options?.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS
  }

  reserve(request: {
    classification: WindowClassification
    requestedStableId?: string
  }): WorkbenchWindowReservationResult {
    this.expireReservations()
    if (request.classification !== "workbench") {
      return {
        status: "available",
        counted: false,
        reservationId: null,
        expiresAt: null,
        ...this.counts(),
      }
    }
    if (
      request.requestedStableId &&
      (this.live.has(request.requestedStableId) ||
        [...this.reservations.values()].some(
          (reservation) => reservation.requestedStableId === request.requestedStableId,
        ))
    ) {
      return {
        status: "stable-id-conflict",
        counted: false,
        reservationId: null,
        expiresAt: null,
        stableId: request.requestedStableId,
        ...this.counts(),
      }
    }
    if (this.live.size + this.reservations.size >= MAX_WORKBENCH_WINDOWS) {
      return {
        status: "at-limit",
        counted: false,
        reservationId: null,
        expiresAt: null,
        ...this.counts(),
      }
    }

    const reservationId = `workbench-reservation-${this.nextReservation++}`
    const expiresAt = this.now() + this.reservationTtlMs
    this.reservations.set(reservationId, {
      expiresAt,
      requestedStableId: request.requestedStableId,
    })
    return {
      status: "available",
      counted: true,
      reservationId,
      expiresAt,
      ...this.counts(),
    }
  }

  commit(reservationId: string, metadata: WorkbenchWindowMetadata): WorkbenchWindowCommitResult {
    this.expireReservations()
    const reservation = this.reservations.get(reservationId)
    if (!reservation) {
      this.expiredReservations.delete(reservationId)
      return { status: "reservation-expired", ...this.counts() }
    }

    this.reservations.delete(reservationId)
    this.expiredReservations.delete(reservationId)
    if (reservation.requestedStableId && reservation.requestedStableId !== metadata.stableId) {
      return {
        status: "stable-id-mismatch",
        requestedStableId: reservation.requestedStableId,
        actualStableId: metadata.stableId,
        ...this.counts(),
      }
    }
    if (this.live.has(metadata.stableId)) {
      return {
        status: "stable-id-conflict",
        stableId: metadata.stableId,
        ...this.counts(),
      }
    }
    this.live.set(metadata.stableId, {
      ...metadata,
      state: "available",
      lastFocusedAt: this.now(),
    })
    return { status: "available", stableId: metadata.stableId, ...this.counts() }
  }

  cancel(reservationId: string | null | undefined): boolean {
    if (!reservationId) return false
    this.expireReservations()
    const canceled = this.reservations.delete(reservationId)
    if (!canceled) this.expiredReservations.delete(reservationId)
    return canceled
  }

  release(stableId: string): boolean {
    this.expireReservations()
    return this.live.delete(stableId)
  }

  markRecovering(stableId: string): boolean {
    return this.updateLive(stableId, (entry) => ({ ...entry, state: "recovering" }))
  }

  markAvailable(stableId: string): boolean {
    return this.updateLive(stableId, (entry) => ({ ...entry, state: "available" }))
  }

  markFocused(stableId: string): boolean {
    return this.updateLive(stableId, (entry) => ({ ...entry, lastFocusedAt: this.now() }))
  }

  inspect(): WorkbenchWindowInspection {
    this.expireReservations()
    const counts = this.counts()
    return {
      status: counts.availableSlots > 0 ? "available" : "at-limit",
      ...counts,
    }
  }

  selectRestorableWindows<T extends RestorableWindow>(
    savedWindows: readonly T[],
  ): { active: T[]; dormant: T[]; needsMain: boolean } {
    const valid = savedWindows.filter((entry) => entry.valid)
    const main = valid.find((entry) => entry.stableId === "main")
    const auxiliary = valid
      .filter((entry) => entry.stableId !== "main")
      .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)
    const auxiliarySlots = MAX_WORKBENCH_WINDOWS - 1
    return {
      active: [...(main ? [main] : []), ...auxiliary.slice(0, auxiliarySlots)],
      dormant: auxiliary.slice(auxiliarySlots),
      needsMain: !main,
    }
  }

  private expireReservations(): void {
    const now = this.now()
    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) {
        this.reservations.delete(reservationId)
        this.expiredReservations.add(reservationId)
        while (this.expiredReservations.size > MAX_EXPIRED_RESERVATION_TOMBSTONES) {
          const oldest = this.expiredReservations.values().next().value
          if (oldest === undefined) break
          this.expiredReservations.delete(oldest)
        }
      }
    }
  }

  private counts(): WorkbenchWindowCounts {
    return {
      maximum: MAX_WORKBENCH_WINDOWS,
      liveCount: this.live.size,
      reservedCount: this.reservations.size,
      availableSlots: Math.max(0, MAX_WORKBENCH_WINDOWS - this.live.size - this.reservations.size),
      expiredReservationCount: this.expiredReservations.size,
      destinations: [...this.live.values()]
        .sort((left, right) => {
          if (left.stableId === "main") return -1
          if (right.stableId === "main") return 1
          return right.lastFocusedAt - left.lastFocusedAt
        })
        .map((entry, index) => ({
          stableId: entry.stableId,
          label: entry.kind === "main" ? "Main window" : `Window ${index + 1}`,
          kind: entry.kind,
          state: entry.state,
          hasProject: entry.hasProject,
          hasChat: entry.hasChat,
          actions:
            entry.state === "available" ? (["focus", "cancel"] as const) : (["cancel"] as const),
        })),
    }
  }

  private updateLive(stableId: string, update: (entry: LiveWindow) => LiveWindow): boolean {
    const existing = this.live.get(stableId)
    if (!existing) return false
    this.live.set(stableId, update(existing))
    return true
  }
}

export const windowBudget = new WindowBudget()

export function cleanupFailedWorkbenchWindowCreation<TWindow>(input: {
  budget: WindowBudget
  reservationId: string
  stableId: string | null
  window: TWindow | null
  unregister: (window: TWindow) => void
  destroy: (window: TWindow) => void
}): void {
  input.budget.cancel(input.reservationId)
  if (input.stableId) input.budget.release(input.stableId)
  if (!input.window) return
  input.unregister(input.window)
  input.destroy(input.window)
}

export class WorkbenchWindowLimitError extends Error {
  constructor(
    readonly decision: Extract<WorkbenchWindowReservationResult, { status: "at-limit" }>,
  ) {
    const existingStableIds = decision.destinations.map((destination) => destination.stableId)
    super(
      `Flapstack supports at most four workbench windows. Choose an existing window: ${existingStableIds.join(", ")}.`,
    )
    this.name = "WorkbenchWindowLimitError"
  }
}

export function createWorkbenchWindowCreationFailure(
  reason: WorkbenchWindowCreationFailureReason,
  destinations: WorkbenchWindowDestination[],
): WorkbenchWindowCreationFailure {
  return reason === "window-limit" ? { reason, destinations } : { reason }
}

export const WORKBENCH_WINDOW_SESSION_VERSION = 2
const MAX_PERSISTED_WORKBENCH_WINDOWS = 128

export interface PersistedWorkbenchWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PersistedWorkbenchWindowLaunch {
  chatId?: string
  subChatId?: string
  projectId?: string
  workspaceId?: string
  paneId?: string
  skipPaneId?: string
}

export interface PersistedWorkbenchWindow {
  stableId: string
  kind?: "main" | "chat" | "saved-workspace"
  lastFocusedAt: number
  launch: PersistedWorkbenchWindowLaunch
  bounds?: PersistedWorkbenchWindowBounds
  displayId?: string
  compact?: boolean
  layout?: ChatWorkbenchLayout
  draftRefs?: Record<string, string>
  scrollAnchorRefs?: Record<string, string>
}

export interface WorkbenchWindowSessionStorage {
  read(): string | null
  readBackup?(): string | null
  write(serialized: string): void
}

export function createFileWorkbenchWindowSessionStorage(
  filePath: string,
): WorkbenchWindowSessionStorage {
  const backupPath = `${filePath}.backup`
  return {
    read: () => (existsSync(filePath) ? readFileSync(filePath, "utf8") : null),
    readBackup: () => (existsSync(backupPath) ? readFileSync(backupPath, "utf8") : null),
    write: (serialized) => {
      mkdirSync(dirname(filePath), { recursive: true })
      if (existsSync(filePath)) writeAtomicFile(backupPath, readFileSync(filePath, "utf8"))
      writeAtomicFile(filePath, serialized)
    },
  }
}

export type WorkbenchWindowSessionInspection =
  | { status: "ready"; windows: PersistedWorkbenchWindow[]; isolatedCount: number }
  | {
      status: "corrupt"
      windows: []
      isolatedCount: number
    }

export class WorkbenchWindowSessionCorruptError extends Error {
  constructor() {
    super("Persisted workbench-window state is corrupt and was preserved unchanged.")
    this.name = "WorkbenchWindowSessionCorruptError"
  }
}

export class WorkbenchWindowSessionStore {
  private readonly storage: WorkbenchWindowSessionStorage
  private readonly now: () => number
  private readonly windows = new Map<string, PersistedWorkbenchWindow>()
  private isolatedCount = 0
  private corrupt = false

  constructor(storage: WorkbenchWindowSessionStorage, options?: { now?: () => number }) {
    this.storage = storage
    this.now = options?.now ?? Date.now
    this.load()
  }

  inspect(): WorkbenchWindowSessionInspection {
    return this.corrupt
      ? { status: "corrupt", windows: [], isolatedCount: this.isolatedCount }
      : { status: "ready", windows: this.sortedWindows(), isolatedCount: this.isolatedCount }
  }

  get(stableId: string): PersistedWorkbenchWindow | null {
    const existing = this.windows.get(stableId)
    return existing ? clonePersistedWindow(existing) : null
  }

  upsert(window: PersistedWorkbenchWindow): void {
    this.assertWritable()
    const existing = this.windows.get(window.stableId)
    const validated = parsePersistedWindow(
      existing
        ? {
            ...existing,
            ...window,
            launch: { ...existing.launch, ...window.launch },
          }
        : window,
    )
    if (!validated) throw new Error("Invalid persisted workbench-window record.")
    this.windows.set(validated.stableId, validated)
    this.persist()
  }

  touch(stableId: string, bounds?: PersistedWorkbenchWindowBounds): boolean {
    this.assertWritable()
    const existing = this.windows.get(stableId)
    if (!existing) return false
    const validatedBounds = bounds === undefined ? existing.bounds : parseBounds(bounds)
    if (bounds !== undefined && !validatedBounds) {
      throw new Error("Invalid persisted workbench-window bounds.")
    }
    this.windows.set(stableId, {
      ...existing,
      lastFocusedAt: this.now(),
      ...(validatedBounds ? { bounds: validatedBounds } : {}),
    })
    this.persist()
    return true
  }

  updateBounds(stableId: string, bounds: PersistedWorkbenchWindowBounds): boolean {
    this.assertWritable()
    const existing = this.windows.get(stableId)
    if (!existing) return false
    const validatedBounds = parseBounds(bounds)
    if (!validatedBounds) throw new Error("Invalid persisted workbench-window bounds.")
    this.windows.set(stableId, { ...existing, bounds: validatedBounds })
    this.persist()
    return true
  }

  updatePresentation(stableId: string, input: ChatWorkbenchSessionPresentation): boolean {
    this.assertWritable()
    const existing =
      this.windows.get(stableId) ??
      ({
        stableId,
        kind: stableId === "main" ? "main" : "chat",
        lastFocusedAt: this.now(),
        launch: {},
      } satisfies PersistedWorkbenchWindow)
    const presentation = chatWorkbenchSessionPresentationSchema.parse(input)
    const validated = parsePersistedWindow({
      ...existing,
      layout: presentation.layout,
      compact: presentation.compact,
      draftRefs: presentation.draftRefs,
      scrollAnchorRefs: presentation.scrollAnchorRefs,
    })
    if (!validated) throw new Error("Invalid workbench presentation state.")
    this.windows.set(stableId, validated)
    this.persist()
    return true
  }

  remove(stableId: string): boolean {
    this.assertWritable()
    const removed = this.windows.delete(stableId)
    if (removed) this.persist()
    return removed
  }

  exportSnapshot(): string {
    this.assertWritable()
    return `${JSON.stringify({
      version: WORKBENCH_WINDOW_SESSION_VERSION,
      windows: this.sortedWindows(),
    })}\n`
  }

  importSnapshot(serialized: string): { imported: number; isolated: number } {
    this.assertWritable()
    const parsed = parseSessionSnapshot(serialized)
    if (!parsed) throw new Error("Invalid workbench-window session import.")
    this.windows.clear()
    for (const window of parsed.windows) this.windows.set(window.stableId, window)
    this.isolatedCount = parsed.isolatedCount
    this.persist()
    return { imported: parsed.windows.length, isolated: parsed.isolatedCount }
  }

  selectForStartup(): {
    active: PersistedWorkbenchWindow[]
    dormant: PersistedWorkbenchWindow[]
  } {
    const windows = this.sortedWindows()
    const main =
      windows.find((window) => window.stableId === "main") ??
      ({
        stableId: "main",
        lastFocusedAt: this.now(),
        launch: {},
      } satisfies PersistedWorkbenchWindow)
    const auxiliary = windows
      .filter((window) => window.stableId !== "main")
      .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)
    return {
      active: [main, ...auxiliary.slice(0, MAX_WORKBENCH_WINDOWS - 1)],
      dormant: auxiliary.slice(MAX_WORKBENCH_WINDOWS - 1),
    }
  }

  nextDormant(activeStableIds: readonly string[]): PersistedWorkbenchWindow | null {
    const active = new Set(activeStableIds)
    if (active.size >= MAX_WORKBENCH_WINDOWS) return null
    return (
      this.sortedWindows()
        .filter((window) => !active.has(window.stableId))
        .sort((left, right) => {
          if (left.stableId === "main") return -1
          if (right.stableId === "main") return 1
          return right.lastFocusedAt - left.lastFocusedAt
        })[0] ?? null
    )
  }

  private load(): void {
    let serialized: string | null
    try {
      serialized = this.storage.read()
    } catch {
      this.corrupt = true
      return
    }
    if (serialized === null) return
    const primary = parseSessionSnapshot(serialized)
    const backup =
      primary === null && this.storage.readBackup
        ? safelyParseSessionSnapshot(this.storage.readBackup)
        : null
    const parsed = primary ?? backup
    if (!parsed) {
      this.windows.clear()
      this.corrupt = true
      return
    }
    this.isolatedCount = parsed.isolatedCount
    for (const window of parsed.windows) this.windows.set(window.stableId, window)
  }

  private sortedWindows(): PersistedWorkbenchWindow[] {
    return [...this.windows.values()]
      .sort((left, right) => {
        if (left.stableId === "main") return -1
        if (right.stableId === "main") return 1
        return right.lastFocusedAt - left.lastFocusedAt
      })
      .map(clonePersistedWindow)
  }

  private persist(): void {
    this.storage.write(this.exportSnapshot())
  }

  private assertWritable(): void {
    if (this.corrupt) throw new WorkbenchWindowSessionCorruptError()
  }
}

function parsePersistedWindow(
  value: unknown,
  sourceVersion = WORKBENCH_WINDOW_SESSION_VERSION,
): PersistedWorkbenchWindow | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const stableId = parsePersistedId(record.stableId)
  if (
    !stableId ||
    typeof record.lastFocusedAt !== "number" ||
    !Number.isFinite(record.lastFocusedAt) ||
    record.lastFocusedAt < 0 ||
    !record.launch ||
    typeof record.launch !== "object" ||
    Array.isArray(record.launch)
  ) {
    return null
  }
  const launchRecord = record.launch as Record<string, unknown>
  const launch: PersistedWorkbenchWindowLaunch = {}
  for (const key of [
    "chatId",
    "subChatId",
    "projectId",
    "workspaceId",
    "paneId",
    "skipPaneId",
  ] as const) {
    if (launchRecord[key] === undefined) continue
    const id = parsePersistedId(launchRecord[key])
    if (!id) return null
    launch[key] = id
  }
  const bounds = record.bounds === undefined ? undefined : parseBounds(record.bounds)
  if (record.bounds !== undefined && !bounds) return null
  const kind =
    sourceVersion === 1 || record.kind === undefined
      ? stableId === "main"
        ? "main"
        : launch.workspaceId
          ? "saved-workspace"
          : "chat"
      : record.kind === "main" || record.kind === "chat" || record.kind === "saved-workspace"
        ? record.kind
        : null
  if (!kind) return null
  const displayId = record.displayId === undefined ? undefined : parsePersistedId(record.displayId)
  if (record.displayId !== undefined && !displayId) return null
  if (record.compact !== undefined && typeof record.compact !== "boolean") return null
  let resolvedLayout: ChatWorkbenchLayout
  if (record.layout === undefined) {
    resolvedLayout = createChatWorkbenchLayout(launch.chatId ? [launch.chatId] : [])
  } else {
    const parsedLayout = chatWorkbenchLayoutSchema.safeParse(record.layout)
    if (!parsedLayout.success) return null
    resolvedLayout = parsedLayout.data
  }
  const draftRefs = parseReferenceMap(record.draftRefs)
  const scrollAnchorRefs = parseReferenceMap(record.scrollAnchorRefs)
  if (
    (record.draftRefs !== undefined && !draftRefs) ||
    (record.scrollAnchorRefs !== undefined && !scrollAnchorRefs)
  ) {
    return null
  }
  return {
    stableId,
    kind,
    lastFocusedAt: record.lastFocusedAt,
    launch,
    layout: resolvedLayout,
    draftRefs: draftRefs ?? {},
    scrollAnchorRefs: scrollAnchorRefs ?? {},
    ...(displayId ? { displayId } : {}),
    ...(record.compact !== undefined ? { compact: record.compact } : {}),
    ...(bounds ? { bounds } : {}),
  }
}

function parsePersistedId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized && normalized.length <= 200 ? normalized : null
}

function parseBounds(value: unknown): PersistedWorkbenchWindowBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const values = [record.x, record.y, record.width, record.height]
  if (
    values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)) ||
    (record.width as number) < 500 ||
    (record.height as number) < 600
  ) {
    return null
  }
  return {
    x: Math.round(record.x as number),
    y: Math.round(record.y as number),
    width: Math.round(record.width as number),
    height: Math.round(record.height as number),
  }
}

export function clampWorkbenchWindowBounds(
  input: { displayId?: string; bounds: PersistedWorkbenchWindowBounds },
  displays: ReadonlyArray<{
    id: string | number
    workArea: PersistedWorkbenchWindowBounds
  }>,
): { displayId: string; bounds: PersistedWorkbenchWindowBounds } {
  if (displays.length === 0) {
    return { displayId: input.displayId ?? "", bounds: { ...input.bounds } }
  }
  const requested = displays.find((display) => String(display.id) === input.displayId)
  const display = requested ?? nearestDisplay(input.bounds, displays)
  const area = display.workArea
  const width = Math.min(input.bounds.width, area.width)
  const height = Math.min(input.bounds.height, area.height)
  return {
    displayId: String(display.id),
    bounds: {
      x: Math.min(Math.max(input.bounds.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(input.bounds.y, area.y), area.y + area.height - height),
      width,
      height,
    },
  }
}

function nearestDisplay(
  bounds: PersistedWorkbenchWindowBounds,
  displays: ReadonlyArray<{
    id: string | number
    workArea: PersistedWorkbenchWindowBounds
  }>,
) {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return [...displays].sort((left, right) => {
    const distance = (display: (typeof displays)[number]) => {
      const areaCenterX = display.workArea.x + display.workArea.width / 2
      const areaCenterY = display.workArea.y + display.workArea.height / 2
      return Math.hypot(centerX - areaCenterX, centerY - areaCenterY)
    }
    return distance(left) - distance(right)
  })[0]
}

function parseReferenceMap(value: unknown): Record<string, string> | null {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 128) return null
  const result: Record<string, string> = {}
  for (const [rawKey, rawValue] of entries) {
    const key = parsePersistedId(rawKey)
    const reference = parsePersistedId(rawValue)
    if (!key || !reference) return null
    result[key] = reference
  }
  return result
}

function parseSessionSnapshot(
  serialized: string,
): { windows: PersistedWorkbenchWindow[]; isolatedCount: number } | null {
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (
      (record.version !== 1 && record.version !== WORKBENCH_WINDOW_SESSION_VERSION) ||
      !Array.isArray(record.windows) ||
      record.windows.length > MAX_PERSISTED_WORKBENCH_WINDOWS
    ) {
      return null
    }
    const windows: PersistedWorkbenchWindow[] = []
    const ids = new Set<string>()
    let isolatedCount = 0
    for (const rawWindow of record.windows) {
      const window = parsePersistedWindow(rawWindow, Number(record.version))
      if (!window || ids.has(window.stableId)) {
        isolatedCount += 1
        continue
      }
      ids.add(window.stableId)
      windows.push(window)
    }
    return { windows, isolatedCount }
  } catch {
    return null
  }
}

function safelyParseSessionSnapshot(read: () => string | null) {
  try {
    const value = read()
    return value === null ? null : parseSessionSnapshot(value)
  } catch {
    return null
  }
}

function writeAtomicFile(filePath: string, serialized: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600)
    writeFileSync(descriptor, serialized, "utf8")
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, filePath)
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}

function clonePersistedWindow(window: PersistedWorkbenchWindow): PersistedWorkbenchWindow {
  return {
    ...window,
    launch: { ...window.launch },
    ...(window.layout ? { layout: structuredClone(window.layout) } : {}),
    ...(window.draftRefs ? { draftRefs: { ...window.draftRefs } } : {}),
    ...(window.scrollAnchorRefs ? { scrollAnchorRefs: { ...window.scrollAnchorRefs } } : {}),
    ...(window.bounds ? { bounds: { ...window.bounds } } : {}),
  }
}
