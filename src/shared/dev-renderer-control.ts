export const DEV_RENDERER_CONTROL_REQUEST_CHANNEL = "dev-renderer-control:request"
export const DEV_RENDERER_CONTROL_RESPONSE_CHANNEL = "dev-renderer-control:response"
export const DEV_MCP_SETTINGS_INVALIDATION_CHANNEL = "dev-mcp:settings-changed"

export const DEV_MCP_SETTINGS_DOMAINS = [
  "credentials",
  "provider-extensions",
  "permissions",
] as const

export type DevMcpSettingsDomain = (typeof DEV_MCP_SETTINGS_DOMAINS)[number]

export type DevMcpSettingsInvalidation = {
  domains: DevMcpSettingsDomain[]
}

export type DevRendererControlCommand =
  | {
      command: "shortcuts.get"
      platform?: "darwin" | "win32" | "linux"
    }
  | {
      command: "shortcuts.mutate"
      operation: "set" | "reset" | "reset-all"
      actionId?: string
      hotkey?: string
      platform?: "darwin" | "win32" | "linux"
    }
  | {
      command: "settings.get"
    }
  | {
      command: "settings.legacy.get"
    }
  | {
      command: "settings.legacy.mutate"
      activeTab?: string
      ctrlTabTarget?: "workspaces" | "agents"
    }
  | {
      command: "settings.control"
      operation: "open" | "close" | "navigate" | "search" | "select-project"
      tab?: string
      query?: string
      targetId?: string
      project?: { id: string; name: string; path: string } | null
    }
  | {
      command: "chat.select"
      chatId: string
      subChatId: string
      project: { id: string; name: string; path: string }
    }
  | {
      command: "permissions.ui.get"
    }
  | {
      command: "permissions.ui.control"
      operation:
        | "select-mode"
        | "set-scope"
        | "set-remember"
        | "set-custom-capability"
        | "set-custom-reviewed"
        | "apply"
        | "cancel"
      mode?: "read-only" | "ask-before-edits" | "auto-edit-project-only" | "full-access" | "custom"
      scope?: "all-chats" | "current-chat"
      enabled?: boolean
      capability?: string
    }

export type DevRendererControlRequest = DevRendererControlCommand & { requestId: string }

export type DevRendererControlResponse = {
  requestId: string
  ok: boolean
  state?: unknown
  error?: string
}

export function parseDevRendererControlRequest(raw: unknown): DevRendererControlRequest | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (typeof value.requestId !== "string" || value.requestId.length < 16) return null
  if (
    ![
      "shortcuts.get",
      "shortcuts.mutate",
      "settings.get",
      "settings.legacy.get",
      "settings.legacy.mutate",
      "settings.control",
      "chat.select",
      "permissions.ui.get",
      "permissions.ui.control",
    ].includes(String(value.command))
  ) {
    return null
  }
  if (
    value.platform !== undefined &&
    !["darwin", "win32", "linux"].includes(String(value.platform))
  ) {
    return null
  }
  if (value.command === "shortcuts.mutate") {
    if (!["set", "reset", "reset-all"].includes(String(value.operation))) return null
    if (value.actionId !== undefined && typeof value.actionId !== "string") return null
    if (
      value.hotkey !== undefined &&
      (typeof value.hotkey !== "string" || value.hotkey.length > 100)
    ) {
      return null
    }
  }
  if (value.command === "settings.control") {
    if (
      !["open", "close", "navigate", "search", "select-project"].includes(String(value.operation))
    ) {
      return null
    }
    if (value.tab !== undefined && (typeof value.tab !== "string" || value.tab.length > 100)) {
      return null
    }
    if (
      value.query !== undefined &&
      (typeof value.query !== "string" || value.query.length > 200)
    ) {
      return null
    }
    if (
      value.targetId !== undefined &&
      (typeof value.targetId !== "string" || value.targetId.length > 200)
    ) {
      return null
    }
    if (value.project !== undefined && value.project !== null) {
      if (typeof value.project !== "object") return null
      const project = value.project as Record<string, unknown>
      if (
        typeof project.id !== "string" ||
        typeof project.name !== "string" ||
        typeof project.path !== "string" ||
        project.id.length > 200 ||
        project.name.length > 500 ||
        project.path.length > 4_096
      ) {
        return null
      }
    }
  }
  if (value.command === "settings.legacy.mutate") {
    if (
      value.activeTab !== undefined &&
      (typeof value.activeTab !== "string" ||
        value.activeTab.length < 1 ||
        value.activeTab.length > 100)
    ) {
      return null
    }
    if (
      value.ctrlTabTarget !== undefined &&
      !["workspaces", "agents"].includes(String(value.ctrlTabTarget))
    ) {
      return null
    }
    if (value.activeTab === undefined && value.ctrlTabTarget === undefined) return null
  }
  if (value.command === "chat.select") {
    if (
      typeof value.chatId !== "string" ||
      value.chatId.length < 1 ||
      value.chatId.length > 200 ||
      typeof value.subChatId !== "string" ||
      value.subChatId.length < 1 ||
      value.subChatId.length > 200 ||
      !value.project ||
      typeof value.project !== "object"
    ) {
      return null
    }
    const project = value.project as Record<string, unknown>
    if (
      typeof project.id !== "string" ||
      typeof project.name !== "string" ||
      typeof project.path !== "string" ||
      project.id.length > 200 ||
      project.name.length > 500 ||
      project.path.length > 4_096
    ) {
      return null
    }
  }
  if (value.command === "permissions.ui.control") {
    if (
      ![
        "select-mode",
        "set-scope",
        "set-remember",
        "set-custom-capability",
        "set-custom-reviewed",
        "apply",
        "cancel",
      ].includes(String(value.operation))
    ) {
      return null
    }
    if (
      value.mode !== undefined &&
      ![
        "read-only",
        "ask-before-edits",
        "auto-edit-project-only",
        "full-access",
        "custom",
      ].includes(String(value.mode))
    ) {
      return null
    }
    if (value.scope !== undefined && !["all-chats", "current-chat"].includes(String(value.scope))) {
      return null
    }
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") return null
    if (
      value.capability !== undefined &&
      (typeof value.capability !== "string" || value.capability.length > 100)
    ) {
      return null
    }
    if (value.operation === "select-mode" && value.mode === undefined) return null
    if (value.operation === "set-scope" && value.scope === undefined) return null
    if (
      ["set-remember", "set-custom-reviewed"].includes(String(value.operation)) &&
      value.enabled === undefined
    ) {
      return null
    }
    if (
      value.operation === "set-custom-capability" &&
      (value.capability === undefined || value.enabled === undefined)
    ) {
      return null
    }
  }
  return value as DevRendererControlRequest
}

export function parseDevRendererControlResponse(raw: unknown): DevRendererControlResponse | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (typeof value.requestId !== "string" || value.requestId.length < 16) return null
  if (typeof value.ok !== "boolean") return null
  if (value.error !== undefined && typeof value.error !== "string") return null
  return value as DevRendererControlResponse
}

export function parseDevMcpSettingsInvalidation(raw: unknown): DevMcpSettingsInvalidation | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.domains) || value.domains.length < 1) return null
  if (
    value.domains.some(
      (domain) =>
        typeof domain !== "string" ||
        !DEV_MCP_SETTINGS_DOMAINS.includes(domain as DevMcpSettingsDomain),
    )
  ) {
    return null
  }
  return { domains: [...new Set(value.domains as DevMcpSettingsDomain[])] }
}
