import {
  agentInputRequestSchema,
  agentInputResponseSchema,
  type AgentInputRequest,
  type AgentInputResolution,
  type AgentInputResponse,
  type AgentInputStatus,
  type AgentInputStatusEvent,
} from "../../../shared/agent-input"

type PendingRequest = {
  request: AgentInputRequest
  resolve: (resolution: AgentInputResolution) => void
  timeout?: ReturnType<typeof setTimeout>
  abortSignal?: AbortSignal
  abortListener?: () => void
}

type StatusListener = (event: AgentInputStatusEvent) => void

export class AgentInputLifecycleService {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<StatusListener>()

  create(
    rawRequest: AgentInputRequest,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<AgentInputResolution> {
    const request = agentInputRequestSchema.parse(rawRequest) as AgentInputRequest
    if (this.pending.has(request.requestId)) {
      throw new Error(`Agent input request ${request.requestId} is already pending.`)
    }
    if ([...this.pending.values()].some((entry) => entry.request.runId === request.runId)) {
      throw new Error(`Run ${request.runId} already has a pending agent input request.`)
    }

    return new Promise<AgentInputResolution>((resolve) => {
      const entry: PendingRequest = { request, resolve, abortSignal: options.signal }
      this.pending.set(request.requestId, entry)
      this.emit(request, "pending")

      const timeoutMs =
        options.timeoutMs ??
        (request.expiresAt !== undefined ? Math.max(0, request.expiresAt - Date.now()) : undefined)
      if (timeoutMs !== undefined) {
        entry.timeout = setTimeout(() => {
          this.finish(request.requestId, {
            status: "expired",
            message: "Structured input request expired.",
          })
        }, timeoutMs)
        entry.timeout.unref?.()
      }

      if (options.signal) {
        entry.abortListener = () => {
          this.finish(request.requestId, {
            status: "cancelled",
            message: "Agent run cancelled while waiting for input.",
          })
        }
        if (options.signal.aborted) entry.abortListener()
        else options.signal.addEventListener("abort", entry.abortListener, { once: true })
      }
    })
  }

  answer(rawResponse: AgentInputResponse): boolean {
    const response = agentInputResponseSchema.parse(rawResponse) as AgentInputResponse
    const entry = this.pending.get(response.requestId)
    if (!entry) return false

    const questionIds = new Set(entry.request.questions.map((question) => question.id))
    for (const [questionId, answers] of Object.entries(response.answers)) {
      if (!questionIds.has(questionId)) throw new Error(`Unknown question ID ${questionId}.`)
      if (answers.length === 0) throw new Error(`Question ${questionId} has no answer.`)
    }
    for (const question of entry.request.questions) {
      const answers = response.answers[question.id] ?? []
      if (!answers.length) {
        throw new Error(`Question ${question.id} requires an answer.`)
      }
      if (!question.multiSelect && answers.length !== 1) {
        throw new Error(`Question ${question.id} accepts exactly one answer.`)
      }
      if (!question.allowCustom) {
        const optionLabels = new Set(question.options.map((option) => option.label))
        if (answers.some((answer) => !optionLabels.has(answer))) {
          throw new Error(`Question ${question.id} does not accept a custom answer.`)
        }
      }
    }

    return this.finish(response.requestId, { status: "answered", response })
  }

  skip(requestId: string, message = "User skipped questions - proceed with defaults"): boolean {
    return this.finish(requestId, { status: "skipped", message })
  }

  cancel(requestId: string, message = "Structured input request cancelled."): boolean {
    return this.finish(requestId, { status: "cancelled", message })
  }

  interrupt(requestId: string, message = "Agent disconnected while waiting for input."): boolean {
    return this.finish(requestId, { status: "interrupted", message })
  }

  cancelByChat(chatId: string, message = "Chat stopped while waiting for input."): number {
    return this.finishWhere((request) => request.chatId === chatId, "cancelled", message)
  }

  cancelByRun(runId: string, message = "Run stopped while waiting for input."): number {
    return this.finishWhere((request) => request.runId === runId, "cancelled", message)
  }

  dispose(message = "Application stopped while waiting for input."): number {
    return this.finishWhere(() => true, "cancelled", message)
  }

  has(requestId: string): boolean {
    return this.pending.has(requestId)
  }

  get(requestId: string): AgentInputRequest | undefined {
    return this.pending.get(requestId)?.request
  }

  list(chatId?: string): AgentInputRequest[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => !chatId || request.chatId === chatId)
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private finish(requestId: string, resolution: AgentInputResolution): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    this.pending.delete(requestId)
    if (entry.timeout) clearTimeout(entry.timeout)
    if (entry.abortSignal && entry.abortListener) {
      entry.abortSignal.removeEventListener("abort", entry.abortListener)
    }
    this.emit(
      entry.request,
      resolution.status,
      resolution.status === "answered" ? resolution.response : undefined,
      resolution.status === "answered" ? undefined : resolution.message,
    )
    entry.resolve(resolution)
    return true
  }

  private finishWhere(
    predicate: (request: AgentInputRequest) => boolean,
    status: Exclude<AgentInputStatus, "pending" | "submitting" | "answered">,
    message: string,
  ): number {
    const requestIds = [...this.pending.values()]
      .filter((entry) => predicate(entry.request))
      .map((entry) => entry.request.requestId)
    for (const requestId of requestIds) this.finish(requestId, { status, message })
    return requestIds.length
  }

  private emit(
    request: AgentInputRequest,
    status: AgentInputStatus,
    response?: AgentInputResponse,
    message?: string,
  ): void {
    const event: AgentInputStatusEvent = {
      requestId: request.requestId,
      chatId: request.chatId,
      runId: request.runId,
      status,
      at: Date.now(),
      ...(response ? { response } : {}),
      ...(message ? { message } : {}),
    }
    for (const listener of this.listeners) listener(event)
  }
}

export const agentInputLifecycle = new AgentInputLifecycleService()
