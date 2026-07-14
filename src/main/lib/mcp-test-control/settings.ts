import {
  SETTINGS_CONTROL_REGISTRY,
  SETTINGS_TAB_REGISTRY,
  getVisibleSettingsTabs,
  type SettingsProviderScope,
} from "../../../renderer/features/settings/settings-visibility"
import { searchSettings } from "../../../renderer/features/settings/settings-search"
import { eq } from "drizzle-orm"
import { getDatabase, subChats } from "../db"
import { extractVisibleMessageParts } from "../../../shared/chat-visible-content"

export function getSettingsState(input?: {
  query?: string
  showDevelopment?: boolean
  availableProviders?: readonly SettingsProviderScope[]
}) {
  const showDevelopment = input?.showDevelopment === true
  const availableProviders = input?.availableProviders ?? []
  const query = input?.query?.trim() ?? ""

  return {
    showDevelopment,
    availableProviders,
    visibleTabs: [
      ...getVisibleSettingsTabs("main", { showDevelopment }),
      ...getVisibleSettingsTabs("advanced", { showDevelopment }),
    ].map(({ id, label, section }) => ({ id, label, section })),
    hiddenTabs: SETTINGS_TAB_REGISTRY.filter((entry) => !entry.released).map((entry) => entry.id),
    controls: SETTINGS_CONTROL_REGISTRY.map((control) => ({
      id: control.id,
      tab: control.tab,
      targetId: control.targetId,
      providerScope: control.providerScope ?? [],
      requiresAvailableProvider: control.requiresAvailableProvider === true,
    })),
    query,
    results: query
      ? searchSettings(query, { showDevelopment, availableProviders }).map((entry) => ({
          id: entry.id,
          tab: entry.tab,
          label: entry.label,
          targetId: entry.targetId,
          providerScope: entry.providerScope ?? [],
        }))
      : [],
  }
}

export function getVisibleCopySearchState(input: {
  subChatId: string
  query?: string
  messageLimit?: number
}) {
  const row = getDatabase()
    .select({ messages: subChats.messages })
    .from(subChats)
    .where(eq(subChats.id, input.subChatId))
    .get()
  if (!row) throw new Error("Sub-chat not found")
  return buildVisibleCopySearchState(row.messages, input.query, input.messageLimit)
}

export function buildVisibleCopySearchState(messagesJson: string, query = "", messageLimit = 30) {
  const parsed = JSON.parse(messagesJson) as unknown
  if (!Array.isArray(parsed)) return { query, messages: [], matchCount: 0 }
  const normalizedQuery = query.trim().toLowerCase()
  const messages = parsed.slice(-Math.min(Math.max(messageLimit, 1), 100)).flatMap((message) => {
    if (!message || typeof message !== "object") return []
    const record = message as Record<string, unknown>
    const parts = Array.isArray(record.parts)
      ? record.parts
      : Array.isArray(record.content)
        ? record.content
        : typeof record.content === "string"
          ? [{ type: "text", text: record.content }]
          : []
    const text = extractVisibleMessageParts({ parts })
      .map((part) => part.text)
      .join("\n")
      .slice(0, 8_000)
    if (!text) return []
    return [
      {
        messageId: typeof record.id === "string" ? record.id : null,
        role: typeof record.role === "string" ? record.role : null,
        text,
        matches: Boolean(normalizedQuery && text.toLowerCase().includes(normalizedQuery)),
      },
    ]
  })
  return { query, messages, matchCount: messages.filter((message) => message.matches).length }
}
