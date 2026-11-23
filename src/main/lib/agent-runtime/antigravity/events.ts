import type { SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk"
import { createTwoFilesPatch } from "diff"
import { eventRecord } from "../event-values"
import type {
  AgentActivityAppend,
  AgentActivityAppendBase,
} from "../../../../shared/agent-activity"

// ACP sends text deltas and tool boundaries, without a final aggregate message.
export class AntigravityEvents {
  private kind: "agent-text" | "provider-visible-reasoning" | null = null
  private pending = ""
  private part = 0
  private answeredSinceTool = false
  private readonly tools = new Map<
    string,
    { name: string; kind?: string | null; outcome?: "completed" | "failed" | "declined" }
  >()
  private readonly pendingDeclines = new Map<string, string | null>()

  constructor(
    private readonly sessionId: string,
    private readonly showThoughts: boolean,
  ) {}

  private identity(): AgentActivityAppendBase {
    return {
      provider: "antigravity",
      providerSessionId: this.sessionId,
      providerItemId: String(this.part),
      phase: "delta",
      displayClass: "provider-visible",
      privacyClass: "public",
    }
  }

  finish(boundary: "final_answer" | "commentary" | null = "final_answer"): AgentActivityAppend[] {
    if (!this.kind) return []
    const base = { ...this.identity(), phase: "completed" as const }
    const event: AgentActivityAppend =
      this.kind === "agent-text"
        ? { ...base, kind: this.kind, sectionBoundary: boundary, payload: { text: this.pending } }
        : { ...base, kind: this.kind, payload: { text: this.pending, label: "Gemini thinking" } }
    this.part++
    this.kind = null
    this.pending = ""
    return [event]
  }

  completionError(): Error | null {
    if (this.answeredSinceTool) return null
    const tools = [...this.tools.values()]
    if (
      tools.length &&
      tools.every((tool) => tool.outcome === "completed" || tool.outcome === "declined")
    )
      return null
    const failed = tools.find((tool) => tool.outcome === "failed")
    const reason = failed
      ? `Gemini ended without a reply after a ${failed.kind === "execute" ? "command" : "tool"} failed.`
      : "Gemini ended without a reply or a completed tool action."
    return new Error(`${reason} Review the activity and continue in this chat.`)
  }

  setFileChangeDeclined(call: ToolCallUpdate, userDeclined: boolean): void {
    const previous = this.tools.get(call.toolCallId)
    if (!userDeclined) {
      this.pendingDeclines.delete(call.toolCallId)
      if (previous?.outcome === "declined") previous.outcome = undefined
      return
    }
    const kind = call.kind ?? previous?.kind
    if (kind !== "edit" && kind !== "delete" && kind !== "move") return
    this.tools.set(call.toolCallId, {
      name: call.title || previous?.name || "File change",
      kind,
      outcome: "declined",
    })
    const path = call.locations?.[0]?.path ?? eventRecord(call.rawInput).Path
    this.pendingDeclines.set(call.toolCallId, typeof path === "string" ? path.slice(0, 1024) : null)
  }

  private declinedEvent(id: string): AgentActivityAppend {
    const path = this.pendingDeclines.get(id)
    this.pendingDeclines.delete(id)
    return {
      ...this.identity(),
      providerItemId: id,
      providerToolId: id,
      phase: "cancelled",
      kind: "patch",
      displayClass: "tool",
      privacyClass: "sensitive",
      payload: { state: "declined", path, summary: "File change declined" },
    }
  }

  finishTurn(): AgentActivityAppend[] {
    return [
      ...this.finish(),
      ...Array.from(this.pendingDeclines.keys(), (id) => this.declinedEvent(id)),
    ]
  }

  update(update: SessionUpdate): AgentActivityAppend[] {
    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      if (update.content.type !== "text" || !update.content.text) return []
      const kind =
        update.sessionUpdate === "agent_message_chunk" ? "agent-text" : "provider-visible-reasoning"
      if (kind === "provider-visible-reasoning" && !this.showThoughts) return []
      if (kind === "agent-text" && update.content.text.trim()) this.answeredSinceTool = true
      const events = this.kind && this.kind !== kind ? this.finish("commentary") : []
      // Each aggregate fits the store's 64 KiB encoded JSON limit, even for escaped controls.
      let delta = ""
      for (const character of update.content.text) {
        if (this.pending.length + delta.length + character.length > 8000) {
          if (delta) events.push(this.delta(kind, delta))
          this.pending += delta
          events.push(...this.finish(null))
          delta = ""
        }
        this.kind = kind
        delta += character
      }
      this.pending += delta
      if (delta) events.push(this.delta(kind, delta))
      return events
    }
    if (update.sessionUpdate === "plan") {
      return [
        ...this.finish("commentary"),
        {
          ...this.identity(),
          kind: "plan",
          phase: "updated",
          payload: {
            items: update.entries
              .slice(0, 24)
              .map((item) => ({ text: item.content.slice(0, 256), status: item.status })),
          },
        },
      ]
    }
    if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update")
      return []
    const events = this.finish("commentary")
    const previous = this.tools.get(update.toolCallId)
    const name = (update.title || previous?.name || "Tool").slice(0, 512)
    const kind = update.kind || previous?.kind
    const exit = eventRecord(update.rawOutput).exit_code
    const failed =
      update.status === "failed" || (kind === "execute" && typeof exit === "number" && exit !== 0)
    if (failed && previous?.outcome === "declined") {
      if (this.pendingDeclines.has(update.toolCallId))
        events.push(this.declinedEvent(update.toolCallId))
      return events
    }
    if (update.status === "completed") this.pendingDeclines.delete(update.toolCallId)
    const outcome = failed
      ? "failed"
      : update.status === "completed"
        ? "completed"
        : previous?.outcome
    if (!previous || failed) this.answeredSinceTool = false
    this.tools.set(update.toolCallId, { name, kind, outcome })
    const phase =
      update.status === "completed" || update.status === "failed"
        ? update.status
        : update.sessionUpdate === "tool_call"
          ? "started"
          : "updated"
    const base: AgentActivityAppendBase = {
      ...this.identity(),
      providerItemId: update.toolCallId,
      providerToolId: update.toolCallId,
      phase,
      displayClass: "tool" as const,
      privacyClass: "sensitive" as const,
    }
    const state = update.status ?? "running"
    const output = (update.content ?? [])
      .flatMap((item) =>
        item.type === "content" && item.content.type === "text"
          ? [item.content.text.slice(0, 4000)]
          : [],
      )
      .join("\n")
      .slice(0, 4000)
    const input = eventRecord(update.rawInput)
    if (kind === "execute") {
      const command =
        typeof input.CommandLine === "string" ? input.CommandLine.slice(0, 4000) : name
      events.push({
        ...base,
        kind: "command",
        payload: {
          command,
          state,
          outputSummary: output || null,
          exitCode: typeof exit === "number" && Number.isSafeInteger(exit) ? exit : null,
        },
      })
    } else if (kind === "edit" || kind === "delete" || kind === "move") {
      const edit = update.content?.find((item) => item.type === "diff")
      const path =
        edit?.path ??
        update.locations?.[0]?.path ??
        (typeof input.Path === "string" ? input.Path : null)
      let diff: string | undefined
      if (edit && edit.newText.length + (edit.oldText?.length ?? 0) <= 32000) {
        diff = createTwoFilesPatch(edit.path, edit.path, edit.oldText ?? "", edit.newText, "", "", {
          context: 2,
          timeout: 25,
        })?.slice(0, 4000)
      }
      events.push({
        ...base,
        kind: "patch",
        payload: { state, path: path?.slice(0, 1024) ?? null, summary: name, diff },
      })
    } else {
      events.push({
        ...base,
        kind: "tool",
        payload: {
          name,
          state,
          outputSummary: output || null,
          inputSummary: update.locations?.[0]?.path?.slice(0, 1024) ?? null,
        },
      })
    }
    return events
  }

  private delta(
    kind: "agent-text" | "provider-visible-reasoning",
    text: string,
  ): AgentActivityAppend {
    return kind === "agent-text"
      ? { ...this.identity(), kind, payload: { text } }
      : { ...this.identity(), kind, payload: { text, label: "Gemini thinking" } }
  }
}
