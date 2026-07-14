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
      showOrchestration?: boolean
    }
  | {
      command: "chat.copy"
      chatId: string
      source: "active-header" | "sidebar-menu"
      expectedText: string
    }
  | {
      command: "agent-input.get"
    }
  | {
      command: "usage-ui.get"
    }
  | {
      command: "voice-ui.get"
      historyId: string
    }
  | {
      command: "voice-ui.control"
      operation:
        | "open"
        | "search"
        | "copy-history"
        | "play-history"
        | "insert-history"
        | "delete-history"
        | "preview"
        | "stop"
        | "set-stt"
        | "set-tts"
        | "set-rate"
      value?: string
      historyId?: string
    }
  | {
      command: "usage-ui.control"
      operation:
        | "open"
        | "select-provider"
        | "set-scope"
        | "set-history-mode"
        | "set-history-range"
        | "open-monitoring"
        | "show-all"
        | "scroll-to"
      value?: string
      target?: "provider-states" | "alerts" | "samples" | "cycles"
    }
  | {
      command: "orchestration.get"
      taskId: string
    }
  | {
      command: "mcp.get"
      chatId: string
    }
  | {
      command: "mcp.control"
      chatId: string
      operation: "open-audit" | "close-audit"
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
  | {
      command: "carryover.get"
      surface: "voice" | "usage" | "reasoning" | "run-change"
      runId?: string
    }
  | {
      command: "carryover.control"
      surface: "reasoning" | "run-change"
      operation: "toggle" | "open-review" | "show-all" | "undo"
      runId?: string
      index?: number
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
      "chat.copy",
      "agent-input.get",
      "voice-ui.get",
      "voice-ui.control",
      "usage-ui.get",
      "usage-ui.control",
      "permissions.ui.get",
      "permissions.ui.control",
      "carryover.get",
      "carryover.control",
      "mcp.get",
      "mcp.control",
      "orchestration.get",
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
    if (value.showOrchestration !== undefined && typeof value.showOrchestration !== "boolean") {
      return null
    }
  }
  if (value.command === "chat.copy") {
    if (
      typeof value.chatId !== "string" ||
      value.chatId.length < 1 ||
      value.chatId.length > 200 ||
      !["active-header", "sidebar-menu"].includes(String(value.source)) ||
      typeof value.expectedText !== "string" ||
      value.expectedText.length < 1 ||
      value.expectedText.length > 200
    ) {
      return null
    }
  }
  if (value.command === "usage-ui.control") {
    if (
      ![
        "open",
        "select-provider",
        "set-scope",
        "set-history-mode",
        "set-history-range",
        "open-monitoring",
        "show-all",
        "scroll-to",
      ].includes(String(value.operation))
    ) {
      return null
    }
    if (
      value.value !== undefined &&
      (typeof value.value !== "string" || value.value.length > 100)
    ) {
      return null
    }
    if (
      value.target !== undefined &&
      !["provider-states", "alerts", "samples", "cycles"].includes(String(value.target))
    ) {
      return null
    }
    if (
      ["select-provider", "set-scope", "set-history-mode", "set-history-range"].includes(
        String(value.operation),
      ) &&
      value.value === undefined
    ) {
      return null
    }
    if (["show-all", "scroll-to"].includes(String(value.operation)) && value.target === undefined) {
      return null
    }
  }
  if (value.command === "voice-ui.control") {
    if (
      ![
        "open",
        "search",
        "copy-history",
        "play-history",
        "insert-history",
        "delete-history",
        "preview",
        "stop",
        "set-stt",
        "set-tts",
        "set-rate",
      ].includes(String(value.operation))
    ) {
      return null
    }
    if (
      value.value !== undefined &&
      (typeof value.value !== "string" || value.value.length > 500)
    ) {
      return null
    }
    if (
      value.historyId !== undefined &&
      (typeof value.historyId !== "string" || value.historyId.length > 200)
    ) {
      return null
    }
    if (
      ["search", "set-stt", "set-tts", "set-rate"].includes(String(value.operation)) &&
      value.value === undefined
    ) {
      return null
    }
    if (
      ["copy-history", "play-history", "insert-history", "delete-history"].includes(
        String(value.operation),
      ) &&
      value.historyId === undefined
    ) {
      return null
    }
  }
  if (
    value.command === "voice-ui.get" &&
    (typeof value.historyId !== "string" ||
      value.historyId.length < 1 ||
      value.historyId.length > 200)
  ) {
    return null
  }
  if (
    value.command === "orchestration.get" &&
    (typeof value.taskId !== "string" || value.taskId.length < 1 || value.taskId.length > 200)
  ) {
    return null
  }
  if (value.command === "mcp.get" || value.command === "mcp.control") {
    if (typeof value.chatId !== "string" || value.chatId.length < 1 || value.chatId.length > 200) {
      return null
    }
    if (
      value.command === "mcp.control" &&
      !["open-audit", "close-audit"].includes(String(value.operation))
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
  if (value.command === "carryover.get" || value.command === "carryover.control") {
    const surfaces =
      value.command === "carryover.get"
        ? ["voice", "usage", "reasoning", "run-change"]
        : ["reasoning", "run-change"]
    if (!surfaces.includes(String(value.surface))) return null
    if (
      value.runId !== undefined &&
      (typeof value.runId !== "string" || value.runId.length > 200)
    ) {
      return null
    }
    if (
      value.index !== undefined &&
      (typeof value.index !== "number" ||
        !Number.isInteger(value.index) ||
        value.index < 0 ||
        value.index > 100)
    ) {
      return null
    }
    if (
      value.command === "carryover.control" &&
      !["toggle", "open-review", "show-all", "undo"].includes(String(value.operation))
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
