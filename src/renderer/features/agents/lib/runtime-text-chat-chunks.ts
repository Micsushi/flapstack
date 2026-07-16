type RuntimeAssistantTextEvent = {
  phase: "started" | "delta" | "completed"
  text: string
  providerItemId: string | null
  providerMessageId: string | null
  contentIndex: number | null
  sectionBoundary: string | null
}

export class RuntimeTextChatChunkMapper {
  private readonly started = new Set<string>()
  private readonly hasDelta = new Set<string>()
  private readonly completed = new Set<string>()
  private activeId: string | null = null

  constructor(
    private readonly runId: string,
    private readonly labelFilter = new RuntimeResponseLabelFilter(false),
  ) {}

  map(event: RuntimeAssistantTextEvent): any[] {
    const id = this.partId(event)
    if (this.completed.has(id)) return []
    const chunks: any[] = []
    if (this.activeId && this.activeId !== id) chunks.push(...this.endActive())
    if (!this.started.has(id)) {
      this.started.add(id)
      this.activeId = id
      chunks.push({ type: "text-start", id })
    } else {
      this.activeId = id
    }

    if (event.phase === "delta" && event.text) {
      this.hasDelta.add(id)
      const delta = this.labelFilter.push(event.text)
      if (delta) chunks.push({ type: "text-delta", id, delta })
    } else if (event.phase === "completed") {
      if (event.text && !this.hasDelta.has(id)) {
        const delta = this.labelFilter.push(event.text)
        if (delta) chunks.push({ type: "text-delta", id, delta })
      }
      chunks.push(...this.endActive())
    }
    return chunks
  }

  beforeActivity(): any[] {
    return this.endActive()
  }

  finish(): any[] {
    return this.endActive()
  }

  private endActive(): any[] {
    if (!this.activeId) return []
    const id = this.activeId
    this.activeId = null
    this.completed.add(id)
    const trailing = this.labelFilter.endPart()
    return [
      ...(trailing ? [{ type: "text-delta", id, delta: trailing }] : []),
      { type: "text-end", id },
    ]
  }

  private partId(event: RuntimeAssistantTextEvent): string {
    const identity = [
      event.providerItemId ?? event.providerMessageId ?? event.sectionBoundary ?? "message",
      event.contentIndex ?? "",
    ].join("-")
    return `runtime-text-${safeRuntimeId(this.runId)}-${safeRuntimeId(identity)}`
  }
}

export class RuntimeResponseLabelFilter {
  private atLineStart = true
  private candidate = ""
  private afterLabel = false
  private readonly labels = ["Spoken:", "Displayed:"]

  constructor(private readonly enabled: boolean) {}

  push(value: string): string {
    if (!this.enabled) return value
    let output = ""
    for (const character of value) {
      if (this.afterLabel) {
        this.afterLabel = false
        if (character === " ") {
          this.atLineStart = false
          continue
        }
        output += character
        this.atLineStart = character === "\n"
        continue
      }
      if (!this.atLineStart) {
        output += character
        if (character === "\n") this.atLineStart = true
        continue
      }

      const next = this.candidate + character
      const matching = this.labels.filter((label) => label.startsWith(next))
      if (matching.length > 0) {
        this.candidate = next
        if (matching.includes(next)) {
          this.candidate = ""
          this.afterLabel = true
        }
        continue
      }

      if (this.candidate) {
        output += this.candidate
        this.candidate = ""
      }
      output += character
      this.atLineStart = character === "\n"
    }
    return output
  }

  flush(): string {
    const output = this.candidate
    this.candidate = ""
    return output
  }

  endPart(): string {
    const output = this.flush()
    this.atLineStart = true
    this.afterLabel = false
    return output
  }
}

export function latestAssistantUsesDirectRuntime(messages: readonly unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== "object") continue
    const record = message as { role?: unknown; metadata?: unknown }
    if (record.role !== "assistant") continue
    if (!record.metadata || typeof record.metadata !== "object") return false
    const transport = (record.metadata as { transport?: unknown }).transport
    return typeof transport === "string" && transport.endsWith("-runtime")
  }
  return false
}

function safeRuntimeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180)
}
