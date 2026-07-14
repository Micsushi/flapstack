export const DEV_TEST_CONTROL_VIEW_CHANNEL = "dev-mcp:view-changed"

export type DevTestControlViewPayload =
  | { action: "project-created" | "project-archived"; projectId: string }
  | { action: "chat-created" | "chat-archived"; chatId: string }
  | { action: "chat-opened"; chatId: string; subChatId: string | null }
  | { action: "orchestration-changed"; taskId: string; chatIds: string[] }
