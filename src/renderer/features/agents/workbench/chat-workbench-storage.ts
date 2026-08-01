import {
  chatWorkbenchLayoutSchema,
  migrateChatWorkbenchLayout,
  type ChatWorkbenchLayout,
} from "../../../../shared/chat-workbench"

const suffix = "agents:chatWorkbench"

export function chatWorkbenchStorageKey(stableWindowId: string) {
  return `${stableWindowId}:${suffix}`
}

export function loadChatWorkbenchLayout(
  storage: Storage,
  stableWindowId: string,
  legacyOpenChatIds: string[],
  legacySelectedChatId: string | null,
): ChatWorkbenchLayout {
  const key = chatWorkbenchStorageKey(stableWindowId)
  for (const candidateKey of [key, `${key}:pending`, `${key}:backup`]) {
    const parsed = parseLayout(storage.getItem(candidateKey))
    if (parsed) return parsed
  }
  const migrated = migrateChatWorkbenchLayout({
    openChatIds: legacyOpenChatIds,
    selectedChatId: legacySelectedChatId,
  })
  persistChatWorkbenchLayout(storage, stableWindowId, migrated)
  return migrated
}

export function persistChatWorkbenchLayout(
  storage: Storage,
  stableWindowId: string,
  layout: ChatWorkbenchLayout,
) {
  const validated = chatWorkbenchLayoutSchema.parse(layout)
  const key = chatWorkbenchStorageKey(stableWindowId)
  const serialized = JSON.stringify(validated)
  const current = storage.getItem(key)
  storage.setItem(`${key}:pending`, serialized)
  if (parseLayout(current)) storage.setItem(`${key}:backup`, current!)
  storage.setItem(key, serialized)
  storage.removeItem(`${key}:pending`)
}

function parseLayout(value: string | null): ChatWorkbenchLayout | null {
  if (!value) return null
  try {
    const parsed = chatWorkbenchLayoutSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
