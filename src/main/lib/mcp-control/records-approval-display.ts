import type { McpApprovalLifecycle } from "./approval-lifecycle"
import { projectActionSchemas } from "./project-control-contract"

const active = new Map<string, McpApprovalLifecycle>()

export function trackRecordsTaskApproval(id: string, approvals: McpApprovalLifecycle) {
  active.set(id, approvals)
  return () => active.delete(id)
}

// Only the owner-facing approvals query receives these details. SQLite and MCP reads stay redacted.
export function withRecordsTaskApprovalDisplay<
  T extends {
    id: string
    toolName: string
    chatId: string
    inputSummary: string
    targetLabel: string
  },
>(view: T): T {
  if (view.toolName !== "create_task") return view
  const pending = active
    .get(view.id)
    ?.listPending()
    .find((item) => item.id === view.id)
  if (!pending || pending.toolName !== view.toolName || pending.caller.chatId !== view.chatId)
    return view
  try {
    if (JSON.parse(view.inputSummary).contextHash !== pending.contextHash) return view
  } catch {
    return view
  }
  const parsed = projectActionSchemas.create_task.safeParse(pending.input)
  if (!parsed.success || !parsed.data.records) return view
  const { name, records } = parsed.data
  // Escape controls in owner-supplied labels so display order and line breaks remain unambiguous.
  const label = (value: string) =>
    value.replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
  return {
    ...view,
    targetLabel: `Project ${label(records.projectId)} · ${records.path ?? "Default Records task document"}`,
    inputSummary: `Create task “${label(name)}”`,
  }
}
