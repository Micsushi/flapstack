import type { AgentActivityAppend } from "../src/shared/agent-activity"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"
import type {
  CodexProtocolClient,
  CodexProtocolNotification,
  CodexProtocolRequestHandler,
  CodexProtocolServerRequest,
} from "../src/main/lib/agent-runtime/codex/protocol-client"

class NotificationQueue implements AsyncIterable<CodexProtocolNotification> {
  private readonly values: CodexProtocolNotification[] = []
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<CodexProtocolNotification>) => void
    reject: (error: Error) => void
  }> = []
  private ended = false
  private error: Error | null = null

  emit(value: CodexProtocolNotification): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve({ done: false, value })
    else this.values.push(value)
  }

  finish(error?: Error): void {
    this.ended = true
    this.error = error ?? null
    for (const waiter of this.waiters.splice(0)) {
      if (this.error) waiter.reject(this.error)
      else waiter.resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CodexProtocolNotification> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value) return { done: false, value }
        if (this.error) throw this.error
        if (this.ended) return { done: true, value: undefined }
        return await new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
      },
    }
  }
}

export class FakeCodexProtocolClient implements CodexProtocolClient {
  readonly requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  readonly responses = new Map<string, unknown>()
  readonly queue = new NotificationQueue()
  closed = false
  diagnostic = ""
  private handler: CodexProtocolRequestHandler = async () => {
    throw new Error("handler missing")
  }

  constructor() {
    this.responses.set("initialize", {
      userAgent: "codex_cli_rs/0.144.1",
      codexHome: "/redacted",
      platformFamily: "unix",
      platformOs: "macos",
    })
    this.responses.set("account/read", { account: { type: "chatgpt" }, requiresOpenaiAuth: true })
    this.responses.set("model/list", {
      data: [{ id: "gpt-5.4", model: "gpt-5.4" }],
      nextCursor: null,
    })
    this.responses.set("thread/start", {
      thread: { id: "thread-1", sessionId: "session-1" },
    })
    this.responses.set("thread/resume", {
      thread: { id: "thread-1", sessionId: "session-1" },
    })
    this.responses.set("thread/fork", {
      thread: { id: "thread-2", sessionId: "session-1", forkedFromId: "thread-1" },
    })
    this.responses.set("thread/archive", {})
    this.responses.set("turn/start", { turn: { id: "turn-1", status: "inProgress" } })
    this.responses.set("turn/interrupt", {})
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params })
    const response = this.responses.get(method)
    if (response instanceof Error) throw response
    if (typeof response === "function") {
      return await (response as (params?: Record<string, unknown>) => unknown)(params)
    }
    return response ?? {}
  }

  notifications(): AsyncIterable<CodexProtocolNotification> {
    return this.queue
  }

  setRequestHandler(handler: CodexProtocolRequestHandler): void {
    this.handler = handler
  }

  async serverRequest(request: CodexProtocolServerRequest): Promise<unknown> {
    return await this.handler(request)
  }

  diagnostics(): string {
    return this.diagnostic
  }

  isAlive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    this.queue.finish()
  }
}

export function runtimeContext(signal = new AbortController().signal): RuntimeAdapterContext {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subChatId: "subchat-1",
    signal,
    launch: {
      schemaVersion: 1,
      harness: "codex",
      model: "gpt-5.4",
      requestedPreference: "codex",
      preferenceSource: "chat",
      resolvedRuntime: "codex",
      compatibility: { compatible: true, harness: "codex", runtime: "codex", reason: null },
      versions: { adapterVersion: "1", protocolVersion: "0.144.1" },
      capabilities: {
        schemaVersion: 1,
        status: "available",
        capturedAt: "2026-07-14T00:00:00.000Z",
        controls: {
          modelThinking: { supported: true, reason: null },
          reasoningDisplay: { supported: true, reason: null },
          subagentActivity: { supported: true, reason: null },
          hookDiagnostics: { supported: true, reason: null },
        },
        limitations: [],
        unavailableReason: null,
      },
      controls: {
        schemaVersion: 1,
        modelEffort: "high",
        modelThinking: true,
        reasoningDisplay: true,
        subagentActivity: true,
        hookDiagnostics: true,
      },
      permission: { mode: "ask-before-edits", customPermissions: null },
    },
  }
}

export function collectActivity() {
  const batches: AgentActivityAppend[][] = []
  return {
    batches,
    append: async (_runId: string, events: AgentActivityAppend[]) => {
      batches.push(events)
    },
    flat: () => batches.flat(),
  }
}
