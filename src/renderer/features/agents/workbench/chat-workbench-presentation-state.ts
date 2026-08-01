import { DRAFTS_STORAGE_KEY } from "../lib/drafts"

const DRAFT_REFERENCE_PREFIX = "workbench:draft:v1:"
const SCROLL_REFERENCE_PREFIX = "workbench:scroll:v1:"
const SCROLL_STORAGE_KEY = "flapstack-workbench-scroll-anchors:v1"
const MAX_SCROLL_CHATS = 256
const MAX_SCROLL_POSITIONS_PER_CHAT = 128

export type WorkbenchScrollPosition = {
  scrollTop: number
  scrollHeight: number
  wasAtBottom: boolean
}

type ScrollAnchorStore = {
  version: 1
  positionsByChat: Record<string, Record<string, WorkbenchScrollPosition>>
}

type PresentationReferences = {
  draftRefs: Record<string, string>
  scrollAnchorRefs: Record<string, string>
}

type RestoredPresentationReferences = {
  draftsByChat: Record<string, Record<string, unknown>>
  scrollPositionsByChat: Record<string, Record<string, WorkbenchScrollPosition>>
}

export function createWorkbenchDraftReference(chatId: string): string {
  return `${DRAFT_REFERENCE_PREFIX}${encodeURIComponent(chatId)}`
}

export function createWorkbenchScrollAnchorReference(chatId: string): string {
  return `${SCROLL_REFERENCE_PREFIX}${encodeURIComponent(chatId)}`
}

export function writeWorkbenchScrollPosition(
  storage: Storage,
  chatId: string,
  subChatId: string,
  position: WorkbenchScrollPosition,
): void {
  const normalized = normalizeScrollPosition(position)
  if (!normalized || !chatId || !subChatId) return
  const store = readScrollAnchorStore(storage)
  const chatPositions = {
    ...(store.positionsByChat[chatId] ?? {}),
    [subChatId]: normalized,
  }
  const boundedPositions = Object.fromEntries(
    Object.entries(chatPositions).slice(-MAX_SCROLL_POSITIONS_PER_CHAT),
  )
  const positionsByChat = {
    ...store.positionsByChat,
    [chatId]: boundedPositions,
  }
  const boundedChats = Object.fromEntries(Object.entries(positionsByChat).slice(-MAX_SCROLL_CHATS))
  try {
    storage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify({ version: 1, positionsByChat: boundedChats } satisfies ScrollAnchorStore),
    )
  } catch {
    // Session restoration is best-effort when browser storage is unavailable.
  }
}

export function readWorkbenchScrollPosition(
  storage: Storage,
  chatId: string,
  subChatId: string,
): WorkbenchScrollPosition | null {
  return readScrollAnchorStore(storage).positionsByChat[chatId]?.[subChatId] ?? null
}

export function restoreWorkbenchPresentationReferences(
  storage: Storage,
  references: PresentationReferences,
): RestoredPresentationReferences {
  const draftsByChat: RestoredPresentationReferences["draftsByChat"] = {}
  const scrollPositionsByChat: RestoredPresentationReferences["scrollPositionsByChat"] = {}
  const drafts = readDraftStore(storage)
  const scrollPositions = readScrollAnchorStore(storage).positionsByChat

  for (const [chatId, reference] of Object.entries(references.draftRefs)) {
    if (readReferencedChatId(reference, DRAFT_REFERENCE_PREFIX) !== chatId) continue
    const prefix = `${chatId}:`
    const matchingDrafts = Object.fromEntries(
      Object.entries(drafts).filter(([draftKey]) => draftKey.startsWith(prefix)),
    )
    if (Object.keys(matchingDrafts).length > 0) draftsByChat[chatId] = matchingDrafts
  }

  for (const [chatId, reference] of Object.entries(references.scrollAnchorRefs)) {
    if (readReferencedChatId(reference, SCROLL_REFERENCE_PREFIX) !== chatId) continue
    const matchingPositions = scrollPositions[chatId]
    if (matchingPositions && Object.keys(matchingPositions).length > 0) {
      scrollPositionsByChat[chatId] = matchingPositions
    }
  }

  return { draftsByChat, scrollPositionsByChat }
}

function readReferencedChatId(reference: string, prefix: string): string | null {
  if (!reference.startsWith(prefix)) return null
  try {
    const chatId = decodeURIComponent(reference.slice(prefix.length))
    return chatId || null
  } catch {
    return null
  }
}

function readDraftStore(storage: Storage): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DRAFTS_STORAGE_KEY) ?? "{}")
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readScrollAnchorStore(storage: Storage): ScrollAnchorStore {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SCROLL_STORAGE_KEY) ?? "{}")
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.positionsByChat)) {
      return { version: 1, positionsByChat: {} }
    }
    const positionsByChat: ScrollAnchorStore["positionsByChat"] = {}
    for (const [chatId, positions] of Object.entries(parsed.positionsByChat)) {
      if (!isRecord(positions)) continue
      const validPositions: Record<string, WorkbenchScrollPosition> = {}
      for (const [subChatId, position] of Object.entries(positions)) {
        const normalized = normalizeScrollPosition(position)
        if (normalized) validPositions[subChatId] = normalized
      }
      if (Object.keys(validPositions).length > 0) positionsByChat[chatId] = validPositions
    }
    return { version: 1, positionsByChat }
  } catch {
    return { version: 1, positionsByChat: {} }
  }
}

function normalizeScrollPosition(value: unknown): WorkbenchScrollPosition | null {
  if (
    !isRecord(value) ||
    typeof value.scrollTop !== "number" ||
    !Number.isFinite(value.scrollTop) ||
    typeof value.scrollHeight !== "number" ||
    !Number.isFinite(value.scrollHeight) ||
    typeof value.wasAtBottom !== "boolean"
  ) {
    return null
  }
  return {
    scrollTop: Math.max(0, value.scrollTop),
    scrollHeight: Math.max(0, value.scrollHeight),
    wasAtBottom: value.wasAtBottom,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
