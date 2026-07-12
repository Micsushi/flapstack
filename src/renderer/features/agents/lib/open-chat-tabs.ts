export function resolveVisibleOpenChatTabs<T extends { id: string }>(params: {
  chats?: T[]
  archivedChats?: T[]
  selectedChat?: T
  openChatIds: string[]
  selectedChatId: string | null
  selectedChatIsRemote: boolean
}): T[] {
  const {
    chats = [],
    archivedChats = [],
    selectedChat,
    openChatIds,
    selectedChatId,
    selectedChatIsRemote,
  } = params

  const chatsById = new Map([...chats, ...archivedChats].map((chat) => [chat.id, chat]))
  if (selectedChat) chatsById.set(selectedChat.id, selectedChat)
  const tabs = openChatIds.map((id) => chatsById.get(id)).filter((chat): chat is T => Boolean(chat))

  if (selectedChatIsRemote || !selectedChatId || tabs.some((chat) => chat.id === selectedChatId)) {
    return tabs
  }

  const resolvedSelectedChat = chatsById.get(selectedChatId)
  return resolvedSelectedChat ? [resolvedSelectedChat, ...tabs] : tabs
}

const DEFAULT_PROJECT_COLOR = "#38bdf8"
const GLOBAL_CHAT_COLOR = "#64748b"
export const ARCHIVED_CHAT_ACCENT_COLOR = "#ff1f1f"

export function isReservedArchivedAccentColor(color: string | null | undefined): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? "")
  if (!match) return false

  const value = Number.parseInt(match[1], 16)
  const red = ((value >> 16) & 0xff) / 255
  const green = ((value >> 8) & 0xff) / 255
  const blue = (value & 0xff) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta === 0 || max === 0 || delta / max < 0.45) return false

  let hue: number
  if (max === red) hue = 60 * (((green - blue) / delta) % 6)
  else if (max === green) hue = 60 * ((blue - red) / delta + 2)
  else hue = 60 * ((red - green) / delta + 4)
  if (hue < 0) hue += 360

  return hue <= 12 || hue >= 348
}

export function resolveProjectAccentColor(
  projectId: string,
  projectColorsById: Record<string, string>,
): string {
  const projectColor = projectColorsById[projectId]
  return projectColor && !isReservedArchivedAccentColor(projectColor)
    ? projectColor
    : DEFAULT_PROJECT_COLOR
}

export function resolveOpenChatTabUnderlineColor(
  chat: { projectId?: string | null; archivedAt?: unknown },
  projectColorsById: Record<string, string>,
): string {
  if (chat.archivedAt) return ARCHIVED_CHAT_ACCENT_COLOR
  if (!chat.projectId) return GLOBAL_CHAT_COLOR
  return resolveProjectAccentColor(chat.projectId, projectColorsById)
}
