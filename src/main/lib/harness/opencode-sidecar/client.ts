/**
 * OpenCode HTTP/SSE client (Track E — E2).
 *
 * Small typed client over the OpenCode server, ported from Vibe Kanban's
 * `sdk.rs`. Auth is HTTP Basic `opencode:{password}` plus an
 * `x-opencode-directory` header; every request also carries `?directory=`.
 *
 * Scaffolding stage: request builders, auth, and JSON typing are real. Methods
 * that require a live server (health, session, prompt, event stream) are
 * implemented against `fetch` but are not yet driven by a persisted run loop —
 * the orchestrator (`session.ts`) marks the run path as not-implemented.
 */

import { randomBytes } from "node:crypto"
import type { OpencodeModelSpec } from "./contract"
import type { OpencodeSessionPermission } from "./permissions"

export type OpencodeClientOptions = {
  baseUrl: string
  directory: string
  password: string
  fetchImpl?: typeof fetch
}

export type OpencodeHealth = { healthy: boolean; version: string }

export class OpencodeClient {
  private readonly baseUrl: string
  private readonly directory: string
  private readonly authHeader: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: OpencodeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.directory = opts.directory
    this.authHeader = "Basic " + Buffer.from(`opencode:${opts.password}`).toString("base64")
    this.fetchImpl = opts.fetchImpl ?? fetch
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

  async health(): Promise<OpencodeHealth> {
    const resp = await this.fetchImpl(this.url("/global/health"), { headers: this.headers() })
    if (!resp.ok) throw new Error(`OpenCode health failed: HTTP ${resp.status}`)
    return (await resp.json()) as OpencodeHealth
  }

  /** Poll health until healthy or the deadline passes. */
  async waitForHealth(timeoutMs = 20_000, signal?: AbortSignal): Promise<OpencodeHealth> {
    const deadline = Date.now() + timeoutMs
    let lastErr = "unknown error"
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Aborted while waiting for OpenCode health")
      try {
        const health = await this.health()
        if (health.healthy) return health
        lastErr = `unhealthy (version ${health.version})`
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`Timed out waiting for OpenCode health: ${lastErr}`)
  }

  async createSession(permission?: OpencodeSessionPermission[]): Promise<string> {
    const resp = await this.fetchImpl(this.url("/session"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(permission ? { permission } : {}),
    })
    if (!resp.ok) throw new Error(`OpenCode session.create failed: HTTP ${resp.status}`)
    return ((await resp.json()) as { id: string }).id
  }

  async forkSession(sessionId: string): Promise<string> {
    const resp = await this.fetchImpl(this.url(`/session/${sessionId}/fork`), {
      method: "POST",
      headers: this.headers(),
      body: "{}",
    })
    if (!resp.ok) throw new Error(`OpenCode session.fork failed: HTTP ${resp.status}`)
    return ((await resp.json()) as { id: string }).id
  }

  /** Apply the current Flapstack mode to a resumed OpenCode session. */
  async setSessionPermissions(
    sessionId: string,
    permission: OpencodeSessionPermission[],
  ): Promise<void> {
    const resp = await this.fetchImpl(this.url(`/session/${sessionId}`), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ permission }),
    })
    if (!resp.ok) throw new Error(`OpenCode session permission update failed: HTTP ${resp.status}`)
  }

  async prompt(sessionId: string, text: string, model?: OpencodeModelSpec): Promise<void> {
    const body = {
      ...(model ? { model: { providerID: model.providerId, modelID: model.modelId } } : {}),
      parts: [{ type: "text", text }],
    }
    const resp = await this.fetchImpl(this.url(`/session/${sessionId}/message`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "")
      throw new Error(`OpenCode session.prompt failed: HTTP ${resp.status} ${errBody}`)
    }
  }

  async abort(sessionId: string): Promise<void> {
    try {
      await this.fetchImpl(this.url(`/session/${sessionId}/abort`), {
        method: "POST",
        headers: this.headers(),
      })
    } catch {
      // Best-effort; process kill is the hard stop.
    }
  }

  async replyPermission(
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ): Promise<void> {
    const body =
      reply === "reject" ? { reply, message: message ?? "Denied by Flapstack" } : { reply }
    const resp = await this.fetchImpl(this.url(`/permission/${requestId}/reply`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`OpenCode permission reply failed: HTTP ${resp.status}`)
  }

  /** Raw SSE event stream Response for the event bridge to consume. */
  async openEventStream(signal?: AbortSignal): Promise<Response> {
    const resp = await this.fetchImpl(this.url("/event"), {
      headers: this.headers({ accept: "text/event-stream" }),
      ...(signal ? { signal } : {}),
    })
    if (!resp.ok) throw new Error(`OpenCode event stream failed: HTTP ${resp.status}`)
    return resp
  }
}

/** Cryptographically-random per-run server password. */
export function generateServerPassword(): string {
  return randomBytes(32).toString("base64url")
}
