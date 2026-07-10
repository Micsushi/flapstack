// Provider reasoning normalizers (Stage 2 Track T — T3/T4/T5/T6 scaffolding).
//
// Each normalizer is a pure function: it takes ONE raw parsed provider event and
// returns zero or more `ReasoningOutputEvent`s targeting the shared contract. Live
// stream wiring (feeding these into the run loops) is the remaining per-provider
// work; these functions are the seam so that wiring never needs to invent shapes.
//
// Provider shapes are documented in the Stage 2 provider behavior matrix and
// captured in tests/fixtures/reasoning-output/. Every parser is defensive: unknown or
// absent reasoning yields [] (no visible reasoning output, not an error).

import type { ReasoningOutputEvent, ReasoningOutputProvider } from "./reasoning-output-contract"

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function blockId(provider: ReasoningOutputProvider, raw: any, fallback: string): string {
  const candidate =
    asString(raw?.id) ??
    asString(raw?.item_id) ??
    (typeof raw?.index === "number" ? String(raw.index) : undefined)
  return `${provider}-${candidate ?? fallback}`
}

// ---------------------------------------------------------------------------
// Claude Code / Anthropic (T3)
// ---------------------------------------------------------------------------

export function normalizeClaudeReasoningOutput(raw: any): ReasoningOutputEvent[] {
  // Claude provider content_block_start for a reasoning-output block.
  if (raw?.type === "content_block_start" && raw?.content_block?.type === "thinking") {
    return [
      {
        provider: "claude-code",
        kind: "reasoning-output",
        phase: "start",
        id: blockId("claude-code", raw, "0"),
        text: "",
      },
    ]
  }

  // Claude provider `thinking_delta`.
  if (raw?.delta?.type === "thinking_delta") {
    const text = asString(raw.delta.thinking)
    return text === undefined
      ? []
      : [
          {
            provider: "claude-code",
            kind: "reasoning-output",
            phase: "delta",
            id: blockId("claude-code", raw, "0"),
            text,
          },
        ]
  }

  // Final Claude provider block from the assembled assistant message.
  if (raw?.type === "thinking" && typeof raw.thinking === "string") {
    return [
      {
        provider: "claude-code",
        kind: "reasoning-output",
        phase: "final",
        // Assistant-message fallback blocks do not carry the streaming index.
        // Claude emits its reasoning-output block at index zero, so this still
        // joins the streamed block and lets the accumulator suppress duplicates.
        id: blockId("claude-code", raw, "0"),
        text: raw.thinking,
      },
    ]
  }

  return []
}

// ---------------------------------------------------------------------------
// Codex CLI / OpenAI / ACP (T4)
// ---------------------------------------------------------------------------

export function normalizeCodexReasoningOutput(raw: any): ReasoningOutputEvent[] {
  const events: ReasoningOutputEvent[] = []
  const id = blockId("codex", raw, "reasoning")

  // ACP AgentThoughtChunk / Codex "Thought" delta.
  const acpType = raw?.sessionUpdate ?? raw?.type
  if (acpType === "agent_thought_chunk" || acpType === "Thought") {
    const text = asString(raw?.content?.text) ?? asString(raw?.text) ?? asString(raw?.thought)
    if (text !== undefined) {
      events.push({ provider: "codex", kind: "thought", phase: "delta", id, text })
    }
    return events
  }

  // Codex/OpenAI reasoning payload (session JSONL or streamed reasoning item).
  if (
    raw?.type === "reasoning" ||
    raw?.type === "agent_reasoning" ||
    raw?.msg?.type === "agent_reasoning"
  ) {
    const summary = extractCodexSummary(raw)
    if (summary !== undefined) {
      events.push({
        provider: "codex",
        kind: "reasoning-summary",
        phase: "final",
        id,
        text: summary,
      })
    }
    if (raw?.encrypted_content != null) {
      events.push({
        provider: "codex",
        kind: "opaque",
        phase: "final",
        id,
        opaque: raw.encrypted_content,
      })
    }
    const tokens =
      asNumber(raw?.reasoning_output_tokens) ?? asNumber(raw?.usage?.reasoning_output_tokens)
    if (tokens !== undefined) {
      events.push({ provider: "codex", kind: "reasoning-tokens", phase: "final", id, tokens })
    }
  }

  return events
}

function extractCodexSummary(raw: any): string | undefined {
  const summary = raw?.summary
  if (typeof summary === "string") return asString(summary)
  if (Array.isArray(summary)) {
    const text = summary
      .map((entry: any) => asString(entry?.text) ?? asString(entry))
      .filter((entry: string | undefined): entry is string => entry !== undefined)
      .join("")
    return text.length > 0 ? text : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Cursor Agent (T5)
// ---------------------------------------------------------------------------

export function normalizeCursorReasoningOutput(raw: any): ReasoningOutputEvent[] {
  if (raw?.type !== "thinking") return []
  const id = blockId("cursor", raw, "thinking")
  // Cursor's captured stream uses `text`, but tolerate the partial-output
  // envelope too. The CLI has changed this shape between releases.
  const text = asString(raw?.text) ?? asString(raw?.delta?.text)

  if (raw?.subtype === "completed") {
    return [
      {
        provider: "cursor",
        kind: "reasoning-output",
        phase: "final",
        id,
        ...(text !== undefined ? { text } : {}),
      },
    ]
  }
  // Default to delta (subtype "delta" or unspecified).
  return text === undefined
    ? []
    : [{ provider: "cursor", kind: "reasoning-output", phase: "delta", id, text }]
}

// ---------------------------------------------------------------------------
// OpenRouter direct API (T6)
// ---------------------------------------------------------------------------

export function normalizeOpenRouterReasoningOutput(raw: any): ReasoningOutputEvent[] {
  const events: ReasoningOutputEvent[] = []
  const id = blockId("openrouter", raw, "reasoning")

  // Streaming chunk: choices[0].delta
  const delta = raw?.choices?.[0]?.delta ?? raw?.delta
  const message = raw?.choices?.[0]?.message ?? raw?.message

  const deltaReasoning = asString(delta?.reasoning)
  if (deltaReasoning !== undefined) {
    events.push({
      provider: "openrouter",
      kind: "reasoning-output",
      phase: "delta",
      id,
      text: deltaReasoning,
    })
  }
  events.push(...reasoningDetailsToEvents("openrouter", id, delta?.reasoning_details, "delta"))

  const finalReasoning = asString(message?.reasoning)
  if (finalReasoning !== undefined) {
    events.push({
      provider: "openrouter",
      kind: "reasoning-output",
      phase: "final",
      id,
      text: finalReasoning,
    })
  }
  events.push(...reasoningDetailsToEvents("openrouter", id, message?.reasoning_details, "final"))

  const tokens = asNumber(raw?.usage?.completion_tokens_details?.reasoning_tokens)
  if (tokens !== undefined) {
    events.push({ provider: "openrouter", kind: "reasoning-tokens", phase: "final", id, tokens })
  }

  return events
}

function reasoningDetailsToEvents(
  provider: ReasoningOutputProvider,
  id: string,
  details: unknown,
  phase: "delta" | "final",
): ReasoningOutputEvent[] {
  if (!Array.isArray(details)) return []
  const events: ReasoningOutputEvent[] = []
  for (const [index, detail] of details.entries()) {
    const d: any = detail
    const type = asString(d?.type) ?? ""
    if (type.includes("summary")) {
      const text = asString(d?.summary) ?? asString(d?.text)
      if (text !== undefined) {
        events.push({
          provider,
          kind: "reasoning-summary",
          phase,
          id: `${id}:summary:${index}`,
          text,
        })
      }
    } else if (type.includes("encrypted") || d?.data != null) {
      events.push({
        provider,
        kind: "opaque",
        phase,
        id: `${id}:opaque:${index}`,
        opaque: d?.data ?? d,
      })
    } else {
      const text = asString(d?.text) ?? asString(d?.reasoning)
      if (text !== undefined) {
        events.push({
          provider,
          kind: "reasoning-output",
          phase,
          id: `${id}:reasoning-output:${index}`,
          text,
        })
      }
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// NanoGPT direct API (T6)
// ---------------------------------------------------------------------------

export function normalizeNanoGptReasoningOutput(raw: any): ReasoningOutputEvent[] {
  const events: ReasoningOutputEvent[] = []
  const id = blockId("nanogpt", raw, "reasoning")

  const delta = raw?.choices?.[0]?.delta ?? raw?.delta
  const message = raw?.choices?.[0]?.message ?? raw?.message

  // `reasoning` (current) and `reasoning_content` (legacy) map to the same path.
  const deltaText = asString(delta?.reasoning) ?? asString(delta?.reasoning_content)
  if (deltaText !== undefined) {
    events.push({
      provider: "nanogpt",
      kind: "reasoning-output",
      phase: "delta",
      id,
      text: deltaText,
    })
  }
  events.push(...reasoningDetailsToEvents("nanogpt", id, delta?.reasoning_details, "delta"))

  const finalText = asString(message?.reasoning) ?? asString(message?.reasoning_content)
  if (finalText !== undefined) {
    events.push({
      provider: "nanogpt",
      kind: "reasoning-output",
      phase: "final",
      id,
      text: finalText,
    })
  }
  events.push(...reasoningDetailsToEvents("nanogpt", id, message?.reasoning_details, "final"))

  const tokens = asNumber(raw?.usage?.completion_tokens_details?.reasoning_tokens)
  if (tokens !== undefined) {
    events.push({ provider: "nanogpt", kind: "reasoning-tokens", phase: "final", id, tokens })
  }

  return events
}

// ---------------------------------------------------------------------------
// Local / open model adapters (T6)
// ---------------------------------------------------------------------------

export function normalizeLocalReasoningOutput(raw: any): ReasoningOutputEvent[] {
  const part = raw?.properties?.part ?? raw?.part ?? raw
  const id = blockId("local", part, "reasoning")

  // OpenCode SSE wraps updated parts in `properties.part`, with the newly
  // streamed suffix in `properties.delta`.
  if (part?.type === "reasoning" && typeof raw?.properties?.delta === "string") {
    const text = asString(raw.properties.delta)
    return text === undefined
      ? []
      : [{ provider: "local", kind: "reasoning-output", phase: "delta", id, text }]
  }

  // AI SDK / opencode reasoning parts.
  if (part?.type === "reasoning-delta" || part?.type === "reasoning_delta") {
    const text = asString(part?.text) ?? asString(part?.delta)
    return text === undefined
      ? []
      : [{ provider: "local", kind: "reasoning-output", phase: "delta", id, text }]
  }
  if (part?.type === "reasoning") {
    const text = asString(part?.text)
    return text === undefined
      ? []
      : [{ provider: "local", kind: "reasoning-output", phase: "final", id, text }]
  }

  return []
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const NORMALIZERS: Record<ReasoningOutputProvider, (raw: any) => ReasoningOutputEvent[]> = {
  "claude-code": normalizeClaudeReasoningOutput,
  codex: normalizeCodexReasoningOutput,
  cursor: normalizeCursorReasoningOutput,
  openrouter: normalizeOpenRouterReasoningOutput,
  nanogpt: normalizeNanoGptReasoningOutput,
  local: normalizeLocalReasoningOutput,
}

/** Normalize one raw provider event into shared reasoning-output events. */
export function normalizeReasoningOutput(
  provider: ReasoningOutputProvider,
  raw: unknown,
): ReasoningOutputEvent[] {
  const normalizer = NORMALIZERS[provider]
  if (!normalizer) return []
  try {
    return normalizer(raw)
  } catch {
    // A malformed reasoning payload must never break the run loop.
    return []
  }
}
