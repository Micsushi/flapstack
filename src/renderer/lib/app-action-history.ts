export type AppAction = {
  label: string
  undo: () => unknown | Promise<unknown>
  redo: () => unknown | Promise<unknown>
}

export type AppActionHistorySnapshot = {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  busy: boolean
}

const HISTORY_LIMIT = 100
const listeners = new Set<() => void>()
let past: AppAction[] = []
let future: AppAction[] = []
let pendingRecords: AppAction[] = []
let busy = false
let snapshot = makeSnapshot()

function makeSnapshot(): AppActionHistorySnapshot {
  return {
    canUndo: past.length > 0 && !busy,
    canRedo: future.length > 0 && !busy,
    undoLabel: past.at(-1)?.label ?? null,
    redoLabel: future.at(-1)?.label ?? null,
    busy,
  }
}

function emit() {
  snapshot = makeSnapshot()
  listeners.forEach((listener) => listener())
}

export function recordAppAction(action: AppAction) {
  if (busy) {
    pendingRecords.push(action)
    return
  }
  past = [...past.slice(-(HISTORY_LIMIT - 1)), action]
  future = []
  emit()
}

function flushPendingRecords() {
  if (pendingRecords.length === 0) return
  past = [...past, ...pendingRecords].slice(-HISTORY_LIMIT)
  pendingRecords = []
  future = []
}

export async function undoAppAction() {
  const action = past.at(-1)
  if (!action || busy) return false
  busy = true
  emit()
  try {
    await action.undo()
    past = past.slice(0, -1)
    future = [...future, action]
    return true
  } finally {
    busy = false
    flushPendingRecords()
    emit()
  }
}

export async function redoAppAction() {
  const action = future.at(-1)
  if (!action || busy) return false
  busy = true
  emit()
  try {
    await action.redo()
    future = future.slice(0, -1)
    past = [...past, action]
    return true
  } finally {
    busy = false
    flushPendingRecords()
    emit()
  }
}

export function subscribeAppActionHistory(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAppActionHistorySnapshot() {
  return snapshot
}

export function clearAppActionHistory() {
  past = []
  future = []
  pendingRecords = []
  busy = false
  emit()
}
