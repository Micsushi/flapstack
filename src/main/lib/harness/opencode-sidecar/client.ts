/**
 * OpenCode HTTP/SSE client (Track E - E2).
 *
 * Small typed client over the OpenCode server, ported from Vibe Kanban's
 * `sdk.rs`. Auth is HTTP Basic `opencode:{password}` plus an
 * `x-opencode-directory` header; every request also carries `?directory=`.
 *
 * Request builders, auth, deadlines, cancellation, and JSON typing are used by
 * the persisted run loop in `session.ts`.
 */

import { randomBytes } from "node:crypto"
import type { OpencodeModelSpec, SidecarAttachment } from "./contract"
import type { OpencodeSessionPermission } from "./permissions"

export type OpencodeClientOptions = {
  baseUrl: string
  directory: string
  password: string
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
}

export type OpencodeHealth = { healthy: boolean; version: string }

/** First-run OpenCode project discovery can exceed 30 seconds on macOS. */
export const DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS = 60_000

export class OpencodeClient {
  private readonly baseUrl: string
  private readonly directory: string
  private readonly authHeader: string
  private readonly fetchImpl: typeof fetch
  private readonly requestTimeoutMs: number

  constructor(opts: OpencodeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.directory = opts.directory
    this.authHeader = "Basic " + Buffer.from(`opencode:${opts.password}`).toString("base64")
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: this.authHeader,
      "x-opencode-directory": this.directory,
      "content-type": "application/json",
      ...extra,
    }
  }

  private url(path: string): string {
    const sep = path.includes("?") ? "&" : "?"
    return `${this.baseUrl}${path}${sep}directory=${encodeURIComponent(this.directory)}`
  }

  private async request(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new Error("OpenCode request timed out")),
      timeoutMs,
    )
    try {
      return await raceAbort(
        this.fetchImpl(this.url(path), { ...init, signal: controller.signal }),
        controller.signal,
        signal?.aborted
          ? "OpenCode request aborted"
          : `OpenCode request timed out after ${timeoutMs}ms`,
      )
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          signal?.aborted
            ? "OpenCode request aborted"
            : `OpenCode request timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<{ response: Response; body: T }> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new Error("OpenCode request timed out")),
      this.requestTimeoutMs,
    )
    try {
      const response = await raceAbort(
        this.fetchImpl(this.url(path), { ...init, signal: controller.signal }),
        controller.signal,
        signal?.aborted
          ? "OpenCode request aborted"
          : `OpenCode request timed out after ${this.requestTimeoutMs}ms`,
      )
      const body = await Promise.race([
        response.json() as Promise<T>,
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                new Error(
                  signal?.aborted
                    ? "OpenCode request aborted"
                    : `OpenCode request timed out after ${this.requestTimeoutMs}ms`,
                ),
              ),
            { once: true },
          ),
        ),
      ])
      return { response, body }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
  }

  async health(signal?: AbortSignal): Promise<OpencodeHealth> {
    const { response, body } = await this.requestJson<OpencodeHealth>(
      "/global/health",
      { headers: this.headers() },
      signal,
    )
    if (!response.ok) throw new Error(`OpenCode health failed: HTTP ${response.status}`)
    return body
  }

  /** Poll health until healthy or the deadline passes. */
  async waitForHealth(timeoutMs = 20_000, signal?: AbortSignal): Promise<OpencodeHealth> {
    const deadline = Date.now() + timeoutMs
    let lastErr = "unknown error"
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Aborted while waiting for OpenCode health")
      try {
        const health = await this.health(signal)
        if (health.healthy) return health
        lastErr = `unhealthy (version ${health.version})`
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`Timed out waiting for OpenCode health: ${lastErr}`)
  }

  async createSession(
    permission?: OpencodeSessionPermission[],
    signal?: AbortSignal,
  ): Promise<string> {
    const { response: resp, body } = await this.requestJson<{ id: string }>(
      "/session",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(permission ? { permission } : {}),
      },
      signal,
    )
    if (!resp.ok) throw new Error(`OpenCode session.create failed: HTTP ${resp.status}`)
    return body.id
  }

  async forkSession(sessionId: string, signal?: AbortSignal): Promise<string> {
    const { response: resp, body } = await this.requestJson<{ id: string }>(
      `/session/${sessionId}/fork`,
      {
        method: "POST",
        headers: this.headers(),
        body: "{}",
      },
      signal,
    )
    if (!resp.ok) throw new Error(`OpenCode session.fork failed: HTTP ${resp.status}`)
    return body.id
  }

  /** Apply the current Flapstack mode to a resumed OpenCode session. */
  async setSessionPermissions(
    sessionId: string,
    permission: OpencodeSessionPermission[],
    signal?: AbortSignal,
  ): Promise<void> {
    const resp = await this.request(
      `/session/${sessionId}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ permission }),
      },
      signal,
    )
    if (!resp.ok) throw new Error(`OpenCode session permission update failed: HTTP ${resp.status}`)
  }

  /**
   * Start a prompt without waiting for the provider/tool loop to finish.
   * OpenCode publishes progress and permission requests through the SSE stream.
   */
  async promptAsync(
    sessionId: string,
    text: string,
    model?: OpencodeModelSpec,
    attachments: SidecarAttachment[] = [],
    signal?: AbortSignal,
  ): Promise<void> {
    const body = {
      ...(model ? { model: { providerID: model.providerId, modelID: model.modelId } } : {}),
      parts: [
        ...attachments.map((attachment) => ({ type: "file" as const, ...attachment })),
        { type: "text" as const, text },
      ],
    }
    const resp = await this.request(
      `/session/${sessionId}/prompt_async`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      signal,
    )
    if (!resp.ok) {
      throw new Error(`OpenCode session.prompt_async failed: HTTP ${resp.status}`)
    }
  }

  async abort(sessionId: string): Promise<void> {
    try {
      await this.request(
        `/session/${sessionId}/abort`,
        {
          method: "POST",
          headers: this.headers(),
        },
        undefined,
        3_000,
      )
    } catch {
      // Best-effort; process kill is the hard stop.
    }
  }

  async replyPermission(
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const body =
      reply === "reject" ? { reply, message: message ?? "Denied by Flapstack" } : { reply }
    const resp = await this.request(
      `/permission/${requestId}/reply`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      signal,
    )
    if (!resp.ok) throw new Error(`OpenCode permission reply failed: HTTP ${resp.status}`)
  }

  /** Raw SSE event stream Response for the event bridge to consume. */
  async openEventStream(signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    let resp: Response
    try {
      resp = await raceAbort(
        this.fetchImpl(this.url("/event"), {
          headers: this.headers({ accept: "text/event-stream" }),
          signal: controller.signal,
        }),
        controller.signal,
        signal?.aborted
          ? "OpenCode request aborted"
          : `OpenCode request timed out after ${this.requestTimeoutMs}ms`,
      )
    } finally {
      clearTimeout(timer)
      // Keep the abort listener for the lifetime of the SSE body. The response
      // stream is cancelled when the owning run signal aborts.
    }
    if (!resp.ok) throw new Error(`OpenCode event stream failed: HTTP ${resp.status}`)
    return resp
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(message))
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error(message)), { once: true }),
    ),
  ])
}

/** Cryptographically-random per-run server password. */
export function generateServerPassword(): string {
  return randomBytes(32).toString("base64url")
}
