/**
 * Map normalized sidecar events -> AI SDK UIMessageChunks (Track E - E4).
 *
 * This is the single place the OpenCode sidecar joins the existing renderer
 * stream vocabulary, so OpenRouter/NanoGPT reasoning + text render through the
 * same Reasoning output panel and message parts as Claude/Codex. Stateful: it tracks
 * open text/reasoning part ids so it can emit start/end boundaries correctly.
 */

import type { MessageMetadata, UIMessageChunk } from "../../claude/types"
import type { NormalizedSidecarEvent, SidecarUsage } from "./contract"

export class SidecarChunkMapper {
  private openTextIds = new Set<string>()
  private openReasoningIds = new Set<string>()

  /** Translate one normalized event into zero-or-more UIMessageChunks. */
  map(event: NormalizedSidecarEvent): UIMessageChunk[] {
    switch (event.kind) {
      case "text-delta": {
        const id = `text-${event.partId}`
        const chunks: UIMessageChunk[] = []
        if (!this.openTextIds.has(id)) {
          this.openTextIds.add(id)
          chunks.push({ type: "text-start", id })
        }
        chunks.push({ type: "text-delta", id, delta: event.delta })
        return chunks
      }
      case "reasoning-delta": {
        const id = `reasoning-${event.partId}`
        const chunks: UIMessageChunk[] = []
        if (!this.openReasoningIds.has(id)) {
          this.openReasoningIds.add(id)
          chunks.push({ type: "reasoning-start", id })
        }
        chunks.push({ type: "reasoning-delta", id, delta: event.delta })
        return chunks
      }
      case "reasoning-summary": {
        const id = `reasoning-${event.partId}`
        const chunks: UIMessageChunk[] = []
        if (this.openReasoningIds.delete(id)) chunks.push({ type: "reasoning-end", id })
        chunks.push({ type: "reasoning-start", id })
        chunks.push({ type: "reasoning-delta", id, delta: event.text })
        chunks.push({ type: "reasoning-end", id })
        return chunks
      }
      case "tool-input-start":
        return [
          { type: "tool-input-start", toolCallId: event.toolCallId, toolName: event.toolName },
        ]
      case "tool-input-delta":
        return [
          { type: "tool-input-delta", toolCallId: event.toolCallId, inputTextDelta: event.delta },
        ]
      case "tool-input-available":
        return [
          {
            type: "tool-input-available",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          },
        ]
      case "tool-output":
        return [
          { type: "tool-output-available", toolCallId: event.toolCallId, output: event.output },
        ]
      case "tool-error":
        return [
          { type: "tool-output-error", toolCallId: event.toolCallId, errorText: event.errorText },
        ]
      case "error":
        return [{ type: event.auth ? "auth-error" : "error", errorText: event.errorText }]
      case "usage":
        return [{ type: "message-metadata", messageMetadata: usageToMetadata(event.usage) }]
      default:
        return []
    }
  }

  /** Emit closing boundaries for any still-open text/reasoning parts. */
  finish(): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    for (const id of this.openTextIds) {
      chunks.push({ type: "text-end", id })
    }
    this.openTextIds.clear()
    for (const id of this.openReasoningIds) {
      chunks.push({ type: "reasoning-end", id })
    }
    this.openReasoningIds.clear()
    return chunks
  }
}

function usageToMetadata(usage: SidecarUsage): MessageMetadata {
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.costUsd !== undefined ? { totalCostUsd: usage.costUsd } : {}),
  }
}
