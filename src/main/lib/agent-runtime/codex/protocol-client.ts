import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { sanitizeRuntimeText } from "../sanitizer"

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000
const MAX_PENDING_REQUESTS = 128
const MAX_CONCURRENT_SERVER_REQUESTS = 32
const MAX_QUEUED_NOTIFICATIONS = 2_048
const MAX_PROTOCOL_LINE_BYTES = 1_048_576
const MAX_STDERR_BYTES = 32_768

export type CodexProtocolNotification = {
  method: string
  params: Record<string, unknown>
  emittedAtMs?: number
}

export type CodexProtocolServerRequest = CodexProtocolNotification & {
  id: string | number
}

export type CodexProtocolRequestHandler = (request: CodexProtocolServerRequest) => Promise<unknown>

export interface CodexProtocolClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>
  notifications(): AsyncIterable<CodexProtocolNotification>
  setRequestHandler(handler: CodexProtocolRequestHandler): void
  diagnostics(): string
  isAlive(): boolean
  close(): Promise<void>
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

class AsyncNotificationQueue implements AsyncIterable<CodexProtocolNotification> {
  private readonly values: CodexProtocolNotification[] = []
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<CodexProtocolNotification>) => void
    reject: (error: Error) => void
  }> = []
  private terminalError: Error | null = null
  private ended = false

  push(value: CodexProtocolNotification): boolean {
    if (this.ended) return false
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve({ done: false, value })
    else {
      if (this.values.length >= MAX_QUEUED_NOTIFICATIONS) return false
      this.values.push(value)
    }
    return true
  }

  end(error?: Error): void {
    if (this.ended) return
    this.ended = true
    this.terminalError = error ?? null
    for (const waiter of this.waiters.splice(0)) {
      if (this.terminalError) waiter.reject(this.terminalError)
      else waiter.resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CodexProtocolNotification> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value) return { done: false, value }
        if (this.terminalError) throw this.terminalError
        if (this.ended) return { done: true, value: undefined }
        return await new Promise<IteratorResult<CodexProtocolNotification>>((resolve, reject) => {
          this.waiters.push({ resolve, reject })
        })
      },
    }
  }
}

export type SpawnCodexProtocolClientOptions = {
  command: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  spawnProcess?: (
    command: string,
    args: string[],
    options: { cwd?: string; env: NodeJS.ProcessEnv; windowsHide: boolean },
  ) => ChildProcessWithoutNullStreams
}

export function spawnCodexProtocolClient(
  options: SpawnCodexProtocolClientOptions,
): CodexProtocolClient {
  return new ProcessCodexProtocolClient(options)
}

class ProcessCodexProtocolClient implements CodexProtocolClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly queue = new AsyncNotificationQueue()
  private readonly pending = new Map<number, PendingRequest>()
  private readonly requestTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private nextRequestId = 1
  private activeServerRequests = 0
  private requestHandler: CodexProtocolRequestHandler = async () => {
    throw new Error("No Flapstack authority registered for Codex server request.")
  }
  private stderr = ""
  private stdoutRemainder = Buffer.alloc(0)
  private alive = true
  private closing: Promise<void> | null = null

  constructor(options: SpawnCodexProtocolClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.child = (options.spawnProcess ?? defaultSpawn)(options.command, ["app-server"], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    })

    this.child.stdout.on("data", (chunk: Buffer | string) => this.handleStdoutChunk(chunk))
    this.child.stdout.once("end", () => this.handleStdoutEnd())
    this.child.stdout.once("error", (error) => {
      this.failProtocol(new Error(`[codex-runtime] App Server stdout failed: ${error.message}`))
    })
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderr = boundStderr(`${this.stderr}${String(chunk)}`)
    })
    this.child.stdin.on("error", (error) => {
      this.failProtocol(new Error(`[codex-runtime] App Server stdin failed: ${error.message}`))
    })
    this.child.once("error", (error) => this.failProtocol(error))
    this.child.once("exit", (code, signal) => {
      const detail = this.stderr ? `: ${this.stderr}` : ""
      this.terminate(
        new Error(
          `[codex-runtime] App Server exited (${code ?? "null"}/${signal ?? "none"})${detail}`,
        ),
      )
    })
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.alive) throw new Error(`[codex-runtime] Cannot call ${method}; process exited.`)
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new Error(`[codex-runtime] Too many pending App Server requests.`)
    }
    const id = this.nextRequestId++
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`[codex-runtime] ${method} timed out after ${this.requestTimeoutMs} ms.`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { method, resolve, reject, timeout })
      try {
        this.write({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notifications(): AsyncIterable<CodexProtocolNotification> {
    return this.queue
  }

  setRequestHandler(handler: CodexProtocolRequestHandler): void {
    this.requestHandler = handler
  }

  diagnostics(): string {
    return boundStderr(
      sanitizeRuntimeText(this.stderr, {
        maxLength: Math.max(1, this.stderr.length),
        mode: "diagnostic",
      }),
    )
  }

  isAlive(): boolean {
    return this.alive
  }

  async close(): Promise<void> {
    if (this.closing) return await this.closing
    this.closing = new Promise((resolve, reject) => {
      if (this.hasChildExited()) {
        resolve()
        return
      }
      let forceTimeout: ReturnType<typeof setTimeout> | null = null
      const terminateTimeout = setTimeout(() => {
        if (this.hasChildExited()) return
        this.child.kill("SIGKILL")
        if (this.hasChildExited()) return
        forceTimeout = setTimeout(() => {
          if (!this.hasChildExited()) {
            reject(new Error("[codex-runtime] App Server did not exit after SIGKILL."))
          }
        }, this.shutdownTimeoutMs)
      }, this.shutdownTimeoutMs)
      this.child.once("exit", () => {
        clearTimeout(terminateTimeout)
        if (forceTimeout) clearTimeout(forceTimeout)
        resolve()
      })
      this.child.kill("SIGTERM")
    })
    return await this.closing
  }

  private hasChildExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null
  }

  private handleStdoutChunk(chunk: Buffer | string): void {
    if (!this.alive) return
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let offset = 0
    while (offset < data.length) {
      const newline = data.indexOf(0x0a, offset)
      const end = newline === -1 ? data.length : newline
      const segment = data.subarray(offset, end)
      if (this.stdoutRemainder.length + segment.length > MAX_PROTOCOL_LINE_BYTES) {
        this.failProtocol(new Error("[codex-runtime] Oversized App Server message."))
        return
      }
      if (segment.length > 0) {
        this.stdoutRemainder = Buffer.concat(
          [this.stdoutRemainder, segment],
          this.stdoutRemainder.length + segment.length,
        )
      }
      if (newline === -1) return

      const line =
        this.stdoutRemainder.at(-1) === 0x0d
          ? this.stdoutRemainder.subarray(0, -1)
          : this.stdoutRemainder
      this.stdoutRemainder = Buffer.alloc(0)
      this.handleLine(line.toString("utf8"))
      if (!this.alive) return
      offset = newline + 1
    }
  }

  private handleStdoutEnd(): void {
    if (!this.alive || this.stdoutRemainder.length === 0) return
    this.failProtocol(
      new Error("[codex-runtime] App Server stdout ended with an unterminated JSON-RPC message."),
    )
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isRecord(parsed)) throw new Error("message is not an object")
      message = parsed
    } catch (error) {
      const failure = new Error(`[codex-runtime] Malformed App Server stdout: ${String(error)}`)
      this.stderr = boundStderr(`${this.stderr}\n${failure.message}`)
      this.failProtocol(failure)
      return
    }

    const id = message.id
    if ((typeof id === "number" || typeof id === "string") && !message.method) {
      if (typeof id !== "number") {
        this.failProtocol(new Error("[codex-runtime] String JSON-RPC response id is invalid."))
        return
      }
      if (!(Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        this.failProtocol(new Error("[codex-runtime] JSON-RPC response lacks result or error."))
        return
      }
      if (Object.hasOwn(message, "result") && Object.hasOwn(message, "error")) {
        this.failProtocol(new Error("[codex-runtime] JSON-RPC response has result and error."))
        return
      }
      if (Object.hasOwn(message, "error") && !isRecord(message.error)) {
        this.failProtocol(new Error("[codex-runtime] JSON-RPC error must be an object."))
        return
      }
      const pending = this.pending.get(id)
      if (!pending) {
        this.stderr = boundStderr(`${this.stderr}\nLate JSON-RPC response id ${id}.`)
        return
      }
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      if (isRecord(message.error)) {
        pending.reject(
          new Error(
            `[codex-runtime] ${pending.method} failed: ${stringValue(message.error.message, "JSON-RPC error")}`,
          ),
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    const method = typeof message.method === "string" ? message.method : null
    if (!method) {
      this.failProtocol(new Error("[codex-runtime] Structurally invalid App Server message."))
      return
    }
    if (Object.hasOwn(message, "id") && typeof id !== "number" && typeof id !== "string") {
      this.failProtocol(new Error("[codex-runtime] Invalid JSON-RPC request id type."))
      return
    }
    if (Object.hasOwn(message, "params") && !isRecord(message.params)) {
      this.failProtocol(new Error("[codex-runtime] JSON-RPC params must be an object."))
      return
    }
    const params = isRecord(message.params) ? message.params : {}
    const emittedAtMs = finiteNumber(message.emittedAtMs)
    if (typeof id === "number" || typeof id === "string") {
      if (this.activeServerRequests >= MAX_CONCURRENT_SERVER_REQUESTS) {
        const failure = new Error("[codex-runtime] Too many concurrent App Server requests.")
        if (
          this.writeServerResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32_000, message: failure.message },
          })
        ) {
          this.failProtocol(failure)
        }
        return
      }
      void this.handleServerRequest({ id, method, params, ...(emittedAtMs ? { emittedAtMs } : {}) })
      return
    }
    if (!this.queue.push({ method, params, ...(emittedAtMs ? { emittedAtMs } : {}) })) {
      const failure = new Error(
        `[codex-runtime] App Server notification buffer exceeded ${MAX_QUEUED_NOTIFICATIONS} events.`,
      )
      this.failProtocol(failure)
    }
  }

  private async handleServerRequest(request: CodexProtocolServerRequest): Promise<void> {
    this.activeServerRequests += 1
    let response: Record<string, unknown>
    try {
      const result = await this.requestHandler(request)
      response = { jsonrpc: "2.0", id: request.id, result }
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32_000, message: error instanceof Error ? error.message : String(error) },
      }
    }
    try {
      this.writeServerResponse(response)
    } finally {
      this.activeServerRequests -= 1
    }
  }

  private writeServerResponse(response: Record<string, unknown>): boolean {
    try {
      this.write(response)
      return true
    } catch (error) {
      this.failProtocol(
        new Error(
          `[codex-runtime] Failed to write App Server response: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      return false
    }
  }

  private write(message: Record<string, unknown>): void {
    const serialized = `${JSON.stringify(message)}\n`
    if (Buffer.byteLength(serialized, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
      throw new Error("[codex-runtime] Outbound App Server message exceeds the protocol bound.")
    }
    this.child.stdin.write(serialized)
  }

  private terminate(error: Error): void {
    if (!this.alive) return
    this.alive = false
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    this.queue.end(error)
  }

  private failProtocol(error: Error): void {
    this.terminate(error)
    void this.close().catch((closeError: unknown) => {
      this.stderr = boundStderr(
        `${this.stderr}\n${closeError instanceof Error ? closeError.message : String(closeError)}`,
      )
    })
  }
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; windowsHide: boolean },
): ChildProcessWithoutNullStreams {
  return spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function boundStderr(value: string): string {
  const redacted = value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)-[-A-Za-z0-9_]{8,}\b/g, "[redacted-credential]")
  const bytes = Buffer.from(redacted, "utf8")
  return bytes.length <= MAX_STDERR_BYTES
    ? redacted
    : bytes
        .subarray(bytes.length - MAX_STDERR_BYTES)
        .toString("utf8")
        .replace(/^\uFFFD/, "")
}
