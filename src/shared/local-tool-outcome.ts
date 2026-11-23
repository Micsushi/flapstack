import type { AgentActivityPhase } from "./agent-activity"

const LOCAL_TOOL_LABELS: Record<string, string> = {
  read_file: "File read",
  list_directory: "Directory listing",
  glob: "File search",
  grep: "Text search",
  write_file: "File write",
  edit_file: "File edit",
  apply_patch: "Patch",
  shell_exec: "Command",
  git_exec: "Git command",
  network_fetch: "Network request",
}

export type ToolOutcome = {
  state: "completed" | "denied" | "failed" | "pending" | "interrupted" | "unknown"
  phase: AgentActivityPhase
  reason: string | null
}

export function getToolOutcome(part: Record<string, unknown>, streamState?: unknown): ToolOutcome {
  const result = part.output ?? part.result
  const failedResult =
    !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false
  const state = part.state
  const error = part.errorText
  if (state === "output-denied" || error === "The project write approval was denied.")
    return {
      state: "denied",
      phase: "failed",
      reason:
        error === "The project write approval was denied." ? error : "Tool approval was denied.",
    }
  if (state === "cancelled" || state === "canceled")
    return {
      state: "interrupted",
      phase: "cancelled",
      reason: "Tool outcome unavailable after interruption.",
    }
  if (state === "error" || state === "failed" || state === "output-error" || failedResult)
    return { state: "failed", phase: "failed", reason: "The tool did not complete successfully." }
  if (state === "result" || state === "completed" || state === "output-available")
    return { state: "completed", phase: "completed", reason: null }
  if (
    [
      "pending",
      "running",
      "queued",
      "call",
      "partial-call",
      "input-streaming",
      "input-available",
      "approval-requested",
      "approval-responded",
    ].includes(String(state))
  ) {
    if (streamState === "cancelled" || streamState === "failure")
      return {
        state: "interrupted",
        phase: streamState === "cancelled" ? "cancelled" : "failed",
        reason: "Tool outcome unavailable after interruption.",
      }
    return { state: "pending", phase: "started", reason: null }
  }
  return { state: "unknown", phase: "snapshot", reason: "Tool outcome unavailable." }
}

export function getLocalToolOutcome(part: Record<string, unknown>, streamState?: unknown) {
  const name =
    typeof part.type === "string" && part.type.startsWith("tool-") ? part.type.slice(5) : ""
  if (!Object.hasOwn(LOCAL_TOOL_LABELS, name)) return null
  const outcome = getToolOutcome(part, streamState)
  return { ...outcome, label: `${LOCAL_TOOL_LABELS[name]} ${outcome.state}` }
}
