// Shared reasoning-output stream contract (Stage 2 Track T - T1).
//
// One normalized event shape that every harness/provider adapter targets so the
// renderer never needs provider-specific branches. Rules baked in here:
//   - Only visible reasoning text is ever shown to the user.
//   - Encrypted / provider-private payloads are preserved as opaque metadata but
//     are never rendered as chain-of-thought.
//   - Reasoning token counts are usage/run metadata, not thoughts.
//   - Deltas stream into the panel as they arrive; a final block must not
//     duplicate text already streamed.
//
// Tracking: vault STAGE2-TRACK.md (agentsvault Wiki/Projects/flapstack), "Cross-track - Reasoning Output Parity"// (T0-T7). This module is the T1 deliverable that unblocks T2-T6.

export const REASONING_OUTPUT_PROVIDERS = [
  "claude-code",
  "codex",
  "cursor",
  "openrouter",
  "nanogpt",
  "local",
] as const

export type ReasoningOutputProvider = (typeof REASONING_OUTPUT_PROVIDERS)[number]

/**
 * Semantic category of a reasoning signal. The renderer picks a label and
 * whether text is shown from this, not from the provider identity.
 */
export type ReasoningOutputKind =
  // Live visible reasoning text (Claude/Cursor provider output, plain
  // OpenRouter/NanoGPT `reasoning`, AI SDK/local `reasoning` parts).
  | "reasoning-output"
  // Provider-authored summary of hidden reasoning (OpenAI/Codex reasoning
  // summary, OpenRouter `reasoning_details` summary chunks).
  | "reasoning-summary"
  // Protocol thought chunk (ACP `AgentThoughtChunk`, Codex `Thought`).
  | "thought"
  // Reasoning token count only, with no visible text.
  | "reasoning-tokens"
  // Encrypted / provider-private reasoning. Preserved for continuity/debug,
  // never displayed.
  | "opaque"

/** Streaming lifecycle position of a `ReasoningOutputEvent`. */
export type ReasoningOutputPhase = "start" | "delta" | "final"

/** Human label shown in the Reasoning output panel. `null` kinds are never displayed. */
export type ReasoningOutputLabel = "Reasoning output" | "Reasoning summary" | "Reasoning tokens"

export type ReasoningVisibilityClass =
  "visible-text" | "visible-summary" | "token-only" | "opaque-private" | "absent" | "unsupported"

export const REASONING_OUTPUT_LABELS: Record<ReasoningOutputKind, ReasoningOutputLabel | null> = {
  "reasoning-output": "Reasoning output",
  "reasoning-summary": "Reasoning summary",
  thought: "Reasoning output",
  "reasoning-tokens": "Reasoning tokens",
  opaque: null,
}

/**
 * Normalized reasoning-output event. Every provider adapter emits these; the renderer
 * and persistence layer consume only these.
 */
export interface ReasoningOutputEvent {
  provider: ReasoningOutputProvider
  kind: ReasoningOutputKind
  phase: ReasoningOutputPhase
  /** Stable id grouping all deltas + final of one reasoning block. */
  id: string
  /** Visible reasoning text for this delta/final. Absent for tokens/opaque. */
  text?: string
  /** Reasoning token count, when the provider reports it. */
  tokens?: number
  /**
   * Encrypted / provider-private payload preserved verbatim for continuity or
   * debugging. Never rendered as text.
   */
  opaque?: unknown
}

/** Where a normalized event should be stored. */
export type ReasoningOutputPersistence = "message" | "opaque-metadata" | "usage-metadata"

/**
 * Persistence rule from T1: visible text rides with the message, encrypted data
 * is opaque metadata, token counts go to usage/run metadata.
 */
export function classifyReasoningOutputPersistence(
  event: ReasoningOutputEvent,
): ReasoningOutputPersistence {
  if (event.kind === "opaque") return "opaque-metadata"
  if (event.kind === "reasoning-tokens") return "usage-metadata"
  return "message"
}

/** True when the event carries visible reasoning text the UI should render. */
export function isDisplayableReasoningOutput(event: ReasoningOutputEvent): boolean {
  if (typeof event.text !== "string" || event.text.length === 0) return false
  return (
    event.kind === "reasoning-output" ||
    event.kind === "reasoning-summary" ||
    event.kind === "thought"
  )
}

export function reasoningOutputLabel(event: ReasoningOutputEvent): ReasoningOutputLabel | null {
  return REASONING_OUTPUT_LABELS[event.kind]
}

export function classifyReasoningVisibility(
  event?: ReasoningOutputEvent,
  capabilitySupported = true,
): ReasoningVisibilityClass {
  if (!capabilitySupported) return "unsupported"
  if (!event) return "absent"
  if (event.kind === "reasoning-summary" && isDisplayableReasoningOutput(event)) {
    return "visible-summary"
  }
  if (
    (event.kind === "reasoning-output" || event.kind === "thought") &&
    isDisplayableReasoningOutput(event)
  ) {
    return "visible-text"
  }
  if (event.kind === "reasoning-tokens") return "token-only"
  if (event.kind === "opaque") return "opaque-private"
  return "absent"
}

// ---------------------------------------------------------------------------
// Renderer bridge
// ---------------------------------------------------------------------------

/**
 * Shape consumed by `AgentReasoningOutput` (`tool-ReasoningOutput`
 * part). `ReasoningOutputAccumulator.toParts()` produces these so adapters can feed the
 * current UI without provider-specific renderer branches.
 */
export interface ReasoningOutputUiPart {
  type: "tool-ReasoningOutput"
  toolCallId: string
  toolName: "ReasoningOutput"
  label: ReasoningOutputLabel | null
  input: { text: string }
  state: "input-streaming" | "output-available" | "output-error"
  output?: { completed: boolean }
  /** Reasoning tokens, surfaced when there is no visible text. */
  tokens?: number
}

interface ReasoningOutputBlock {
  provider: ReasoningOutputProvider
  kind: ReasoningOutputKind
  text: string
  tokens?: number
  done: boolean
  order: number
}

/**
 * Reduces a stream of `ReasoningOutputEvent`s into renderable parts (Track T2).
 *
 * - `delta` events append text to the block with the same id (incremental
 *   growth, not one final dump).
 * - A `final` event replaces the block text only when nothing was streamed,
 *   preventing duplicate text when both deltas and a final block arrive.
 * - `reasoning-tokens` and `opaque` events never contribute visible text.
 */
export class ReasoningOutputAccumulator {
  private blocks = new Map<string, ReasoningOutputBlock>()
  private nextOrder = 0

  apply(event: ReasoningOutputEvent): void {
    const existing = this.blocks.get(event.id)
    const block: ReasoningOutputBlock = existing ?? {
      provider: event.provider,
      kind: event.kind,
      text: "",
      done: false,
      order: this.nextOrder++,
    }

    // Track counts/opaque without treating them as visible growth.
    if (typeof event.tokens === "number") {
      block.tokens = (block.tokens ?? 0) + event.tokens
    }
    if (event.kind !== "opaque" && event.kind !== "reasoning-tokens") {
      block.kind = event.kind
    }

    switch (event.phase) {
      case "start":
        // Establish the block; no text yet.
        break
      case "delta":
        if (typeof event.text === "string") block.text += event.text
        break
      case "final":
        if (typeof event.text === "string") {
          // Cumulative final replay replaces a known streamed prefix. Exact
          // replay is a no-op. An independent non-prefix final remains a new
          // provider part and must use its own stable id.
          if (block.text.length === 0 || event.text.startsWith(block.text)) block.text = event.text
        }
        block.done = true
        break
    }

    this.blocks.set(event.id, block)
  }

  applyAll(events: Iterable<ReasoningOutputEvent>): void {
    for (const event of events) this.apply(event)
  }

  toParts(): ReasoningOutputUiPart[] {
    return (
      [...this.blocks.entries()]
        // Opaque payloads are persisted separately and must never produce a
        // Reasoning output row. Token counts remain renderable metadata, never text.
        .filter(([, block]) => block.kind !== "opaque")
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id, block]) => ({
          type: "tool-ReasoningOutput" as const,
          toolCallId: id,
          toolName: "ReasoningOutput" as const,
          label: REASONING_OUTPUT_LABELS[block.kind],
          input: { text: block.text },
          state: block.done ? ("output-available" as const) : ("input-streaming" as const),
          ...(block.done ? { output: { completed: true } } : {}),
          ...(block.tokens !== undefined ? { tokens: block.tokens } : {}),
        }))
    )
  }

  reset(): void {
    this.blocks.clear()
    this.nextOrder = 0
  }
}
