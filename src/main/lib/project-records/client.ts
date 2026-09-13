import { open } from "node:fs/promises"
import {
  patchProjectRecordSchema,
  projectRecordIndexSchema,
  projectRecordPathSchema,
  projectRecordSnapshotSchema,
  yapInputSchema,
  yapProposalSchema,
  yapUploadStartSchema,
  yapUploadSchema,
  type YapInput,
  type YapProposal,
  type YapUpload,
  type ProjectRecordPatch,
  type ProjectRecordWriteResult,
} from "../../../shared/project-records"

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_TOKEN_BYTES = 4096
const BOARD_PATHS = new Set([
  "/v1/documents",
  "/v1/workflow",
  "/v1/document",
  "/v1/export",
  "/v1/agents",
  "/v1/records",
  "/v1/records/search",
  "/v1/record/context",
  "/v1/context",
  "/v1/record",
  "/v1/changes",
  "/v1/records/changes",
  "/v1/setups",
  "/v1/setup",
  "/v1/setup/preview",
  "/v1/record/readiness",
  "/v1/setup/resolve",
  "/v1/record/create",
  "/v1/agents/start",
  "/v1/agents/stop",
  "/v1/agents/resume",
  "/v1/agents/reconcile",
  "/v1/agents/release",
  "/v1/yap/input",
  "/v1/yap/source",
  "/v1/yap/upload",
  "/v1/yap/upload/status",
  "/v1/yap/proposal",
  "/v1/yap/proposal/read",
  "/v1/yap/proposal/review",
  "/v1/yap/proposal/approve",
  "/v1/yap/proposal/apply",
  "/v1/yap/upload/start",
  "/v1/yap/upload/chunk",
  "/v1/yap/upload/finalize",
  "/v1/yap/proposal/cancel",
  "/v1/yap/attachment",
  "/v1/yap/inference",
  "/v1/yap/inference/read",
  "/v1/yap/inference/cancel",
  "/v1/yap/proposal/generate",
  "/v1/yap/proposal/cancel-generation",
])

export class ProjectRecordsOperationError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown,
  ) {
    super(
      typeof details === "object" && details !== null && "message" in details
        ? String((details as { message?: unknown }).message)
        : "Project records operation was refused.",
    )
    this.name = "ProjectRecordsOperationError"
  }
}

export function projectRecordsEndpoint(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Project records requires an HTTP address on 127.0.0.1.")
  return url.origin
}

export class ProjectRecordsClient {
  private readonly endpoint: string
  constructor(
    private readonly options: {
      endpoint: string
      token: string
      fetch?: typeof fetch
      timeoutMs?: number
    },
  ) {
    this.endpoint = projectRecordsEndpoint(options.endpoint)
    if (!options.token || options.token.length > MAX_TOKEN_BYTES || /\s/.test(options.token)) {
      throw new Error("Project records authentication is not configured.")
    }
  }

  private async request(path: string, body?: unknown, board = false) {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ??
        ((path === "/v1/yap/inference" || path === "/v1/yap/proposal/generate") &&
        body !== undefined
          ? // The service permits two five-minute passes, plus response/cleanup time.
            630_000
          : 10_000),
    )
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.endpoint}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      })
      if (
        !response.ok &&
        response.status !== 409 &&
        !(board && [400, 403, 404, 422].includes(response.status))
      ) {
        throw new Error(
          response.status === 401
            ? "Project records authentication failed. Check the local service connection."
            : response.status === 404
              ? "This project record document is unavailable."
              : "Project records could not complete the request.",
        )
      }
      if (!response.body) throw new Error("Project records returned an empty response.")
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_RESPONSE_BYTES) throw new Error("Project records response is too large.")
        chunks.push(value)
      }
      controller.signal.throwIfAborted()
      const raw = Buffer.concat(chunks).toString("utf8")
      return {
        conflict: response.status === 409,
        status: response.status,
        body: raw,
        contentType: response.headers.get("content-type") ?? "application/json",
        data: board ? null : (JSON.parse(raw) as unknown),
      }
    } catch (error) {
      // Never relay a fetch error or remote body that could contain credentials.
      if (error instanceof Error && error.message.startsWith("Project records")) throw error
      throw new Error("Project records is unavailable. Check the local service and retry.")
    } finally {
      clearTimeout(timer)
      controller.abort()
      if (reader) {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    }
  }

  async list() {
    const response = await this.request("/v1/documents")
    return projectRecordIndexSchema.parse(response.data)
  }

  async boardRequest(input: { path: string; method: "GET" | "POST"; body?: string }) {
    const url = new URL(input.path, "http://127.0.0.1")
    if (url.origin !== "http://127.0.0.1" || url.hash || !input.path.startsWith("/v1/"))
      throw new Error("Project records board endpoint is unsupported.")
    if (input.path === "/v1/session" && input.method === "GET")
      return {
        status: 200,
        body: JSON.stringify({ bearer: true }),
        contentType: "application/json",
      }
    const read =
      input.method === "GET" &&
      [
        "/v1/documents",
        "/v1/workflow",
        "/v1/document",
        "/v1/export",
        "/v1/agents",
        "/v1/records",
        "/v1/records/search",
        "/v1/record/context",
        "/v1/context",
        "/v1/record",
        "/v1/record/readiness",
        "/v1/changes",
        "/v1/records/changes",
        "/v1/setups",
        "/v1/setup",
        "/v1/setup/preview",
        "/v1/setup/resolve",
        "/v1/yap/input",
        "/v1/yap/source",
        "/v1/yap/upload",
        "/v1/yap/upload/status",
        "/v1/yap/proposal",
        "/v1/yap/proposal/read",
        "/v1/yap/proposal/review",
        "/v1/yap/proposal/approve",
        "/v1/yap/proposal/apply",
        "/v1/yap/attachment",
        "/v1/yap/inference",
        "/v1/yap/inference/read",
      ].includes(url.pathname)
    const write =
      input.method === "POST" &&
      [
        "/v1/record",
        "/v1/record/create",
        "/v1/workflow",
        "/v1/records",
        "/v1/setups",
        "/v1/setup",
        "/v1/setup/preview",
        "/v1/setup/resolve",
        "/v1/agents/start",
        "/v1/agents/stop",
        "/v1/agents/resume",
        "/v1/agents/reconcile",
        "/v1/agents/release",
        "/v1/yap/upload/start",
        "/v1/yap/upload/chunk",
        "/v1/yap/upload/finalize",
        "/v1/yap/input",
        "/v1/yap/source",
        "/v1/yap/proposal",
        "/v1/yap/proposal/review",
        "/v1/yap/proposal/approve",
        "/v1/yap/proposal/apply",
        "/v1/yap/proposal/cancel",
        "/v1/yap/inference",
        "/v1/yap/proposal/generate",
        "/v1/yap/inference/cancel",
        "/v1/yap/proposal/cancel-generation",
      ].includes(input.path)
    if (!read && !write) throw new Error("Project records board endpoint is unsupported.")
    if (input.body && Buffer.byteLength(input.body) > 256 * 1024)
      throw new Error("Project records change is too large.")
    if (read && input.body) throw new Error("Project records reads cannot contain changes.")
    const result = await this.request(
      input.path,
      write ? JSON.parse(input.body ?? "{}") : undefined,
      true,
    )
    return { status: result.status, body: result.body, contentType: result.contentType }
  }

  async read(path: string) {
    projectRecordPathSchema.parse(path)
    const response = await this.request(`/v1/document?path=${encodeURIComponent(path)}`)
    const snapshot = projectRecordSnapshotSchema.parse(response.data)
    if (snapshot.path !== path) throw new Error("Project records returned a different document.")
    return snapshot
  }

  async patch(input: ProjectRecordPatch): Promise<ProjectRecordWriteResult> {
    const parsed = patchProjectRecordSchema.parse(input)
    if (Buffer.byteLength(JSON.stringify(parsed)) > 256 * 1024) {
      throw new Error("Project records change is too large.")
    }
    // The writer resolves the authenticated owner/worker principal.  Actor
    // labels are deliberately not part of the public mutation contract.
    const response = await this.request("/v1/record", parsed)
    const snapshot = projectRecordSnapshotSchema.parse(response.data)
    if (snapshot.path !== input.path)
      throw new Error("Project records returned a different document.")
    return { conflict: response.conflict, snapshot }
  }

  /**
   * Invoke one of the bounded logical Records operations.  This is kept
   * separate from boardRequest so callers receive structured conflict and
   * ambiguity details while the renderer still uses the same allowlist.
   */
  async operation(path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, "http://127.0.0.1")
    if (url.origin !== "http://127.0.0.1" || url.hash || !BOARD_PATHS.has(url.pathname))
      throw new Error("Project records operation is unsupported.")
    const allowedQuery = new Set(
      url.pathname === "/v1/records" || url.pathname === "/v1/records/search"
        ? ["recordId", "projectId", "kind", "query", "limit"]
        : url.pathname === "/v1/document"
          ? ["path"]
          : url.pathname === "/v1/record" ||
              url.pathname === "/v1/record/context" ||
              url.pathname === "/v1/context" ||
              url.pathname === "/v1/record/readiness"
            ? ["recordId", "path", "projectId"]
            : url.pathname === "/v1/changes" || url.pathname === "/v1/records/changes"
              ? ["since", "projectId"]
              : url.pathname === "/v1/setups" ||
                  url.pathname === "/v1/setup" ||
                  url.pathname === "/v1/setup/preview" ||
                  url.pathname === "/v1/setup/resolve"
                ? ["projectId", "setupId", "version"]
                : url.pathname === "/v1/yap/input" || url.pathname === "/v1/yap/source"
                  ? ["inputId", "id"]
                  : url.pathname === "/v1/yap/upload" || url.pathname === "/v1/yap/upload/status"
                    ? ["uploadId", "id"]
                    : url.pathname === "/v1/yap/proposal" ||
                        url.pathname === "/v1/yap/proposal/read"
                      ? ["proposalId", "id", "projectId"]
                      : url.pathname === "/v1/yap/inference/read"
                        ? ["requestId", "id"]
                        : url.pathname === "/v1/yap/attachment"
                          ? ["attachmentId", "id", "offset", "limit"]
                          : [],
    )
    for (const key of url.searchParams.keys())
      if (!allowedQuery.has(key)) throw new Error("Project records operation is unsupported.")
    const getOnly = new Set([
      "/v1/documents",
      "/v1/document",
      "/v1/export",
      "/v1/agents",
      "/v1/records/search",
      "/v1/record/context",
      "/v1/context",
      "/v1/record/readiness",
      "/v1/changes",
      "/v1/records/changes",
      "/v1/yap/upload",
      "/v1/yap/upload/status",
      "/v1/yap/proposal/read",
      "/v1/yap/attachment",
      "/v1/yap/inference/read",
    ])
    const postOnly = new Set([
      "/v1/record/create",
      "/v1/agents/start",
      "/v1/agents/stop",
      "/v1/agents/resume",
      "/v1/agents/reconcile",
      "/v1/agents/release",
      "/v1/yap/upload/start",
      "/v1/yap/upload/chunk",
      "/v1/yap/upload/finalize",
      "/v1/yap/proposal/review",
      "/v1/yap/proposal/approve",
      "/v1/yap/proposal/apply",
      "/v1/yap/proposal/cancel",
      "/v1/yap/inference",
      "/v1/yap/proposal/generate",
      "/v1/yap/inference/cancel",
      "/v1/yap/proposal/cancel-generation",
    ])
    if (
      (body !== undefined && getOnly.has(url.pathname)) ||
      (body === undefined && postOnly.has(url.pathname))
    )
      throw new Error("Project records operation has an unsupported method.")
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body)) > 256 * 1024)
      throw new Error("Project records change is too large.")
    const response = await this.request(path, body, true)
    let details: unknown
    try {
      details = JSON.parse(response.body) as unknown
    } catch {
      throw new Error("Project records returned invalid JSON.")
    }
    if (response.status >= 400) throw new ProjectRecordsOperationError(response.status, details)
    return details
  }

  async discover(
    input: {
      recordId?: string
      projectId?: string
      kind?: string
      query?: string
      limit?: number
    } = {},
  ) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/records${query.size ? `?${query.toString()}` : ""}`)
  }

  async search(input: { query: string; projectId?: string; kind?: string; limit?: number }) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/records/search?${query.toString()}`)
  }

  async context(input: { recordId: string; path?: string; projectId?: string }) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/record/context?${query.toString()}`)
  }

  async readiness(input: { recordId: string; path?: string; projectId?: string }) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/record/readiness?${query.toString()}`)
  }

  async changes(input: { since?: string; projectId?: string } = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/changes${query.size ? `?${query.toString()}` : ""}`)
  }

  async workflow(input: Record<string, unknown>) {
    return this.operation("/v1/workflow", input)
  }

  async createRecord(input: Record<string, unknown>) {
    return this.operation("/v1/records", input)
  }

  async setup(input: Record<string, unknown>) {
    return this.operation("/v1/setups", input)
  }

  async setups(input: { projectId?: string; setupId?: string } = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value))
    return this.operation(`/v1/setups${query.size ? `?${query.toString()}` : ""}`)
  }

  async startYapUpload(input: Record<string, unknown>): Promise<YapUpload> {
    const parsed = yapUploadStartSchema.parse({ ...input, mime: input.mime ?? input.mimeType })
    const result = await this.operation("/v1/yap/upload/start", parsed)
    return yapUploadSchema.parse((result as { upload?: unknown }).upload)
  }

  async uploadYapChunk(input: {
    uploadId: string
    index: number
    data: string
    chunkSha256?: string
  }): Promise<YapUpload> {
    // JSON transport remains bounded at 256 KiB; callers must split larger
    // attachments into bounded base64 chunks before invoking this method.
    const result = await this.operation("/v1/yap/upload/chunk", input)
    return yapUploadSchema.parse((result as { upload?: unknown }).upload)
  }

  async finalizeYapUpload(uploadId: string): Promise<YapUpload> {
    const result = await this.operation("/v1/yap/upload/finalize", { uploadId })
    return yapUploadSchema.parse((result as { upload?: unknown }).upload)
  }

  async readYapInput(inputId: string): Promise<YapInput> {
    const result = await this.operation(`/v1/yap/input?inputId=${encodeURIComponent(inputId)}`)
    const input = (result as { input?: unknown }).input
    return yapInputSchema.parse(input)
  }

  async readYapAttachment(input: { attachmentId: string; offset?: number; limit?: number }) {
    const query = new URLSearchParams({ attachmentId: input.attachmentId })
    if (input.offset !== undefined) query.set("offset", String(input.offset))
    if (input.limit !== undefined) query.set("limit", String(input.limit))
    return this.operation(`/v1/yap/attachment?${query.toString()}`)
  }

  async createYapInput(input: Record<string, unknown>) {
    const result = await this.operation("/v1/yap/input", input)
    return yapInputSchema.parse((result as { input?: unknown }).input)
  }

  async listYapProposals(projectId?: string) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
    return this.operation(`/v1/yap/proposal${query}`)
  }

  async readYapProposal(proposalId: string): Promise<YapProposal> {
    const result = await this.operation(
      `/v1/yap/proposal?proposalId=${encodeURIComponent(proposalId)}`,
    )
    return yapProposalSchema.parse((result as { proposal?: unknown }).proposal)
  }

  async saveYapProposal(input: Record<string, unknown>) {
    const result = await this.operation("/v1/yap/proposal", input)
    return yapProposalSchema.parse((result as { proposal?: unknown }).proposal)
  }

  async cancelYapProposal(proposalId: string, expectedVersion: number) {
    return this.operation("/v1/yap/proposal/cancel", { proposalId, expectedVersion })
  }

  async approveYapProposal(input: Record<string, unknown>) {
    return this.operation("/v1/yap/proposal/approve", input)
  }

  async applyYapProposal(input: Record<string, unknown>) {
    return this.operation("/v1/yap/proposal/apply", input)
  }

  // Verb-first aliases are retained for direct-tool callers that mirror the
  // Records MCP operation names.
  yapUploadStart(input: Record<string, unknown>) {
    return this.startYapUpload(input)
  }
  yapUploadChunk(input: { uploadId: string; index: number; data: string; chunkSha256?: string }) {
    return this.uploadYapChunk(input)
  }
  yapUploadFinalize(uploadId: string) {
    return this.finalizeYapUpload(uploadId)
  }
  yapInputRead(inputId: string) {
    return this.readYapInput(inputId)
  }
  yapInput(input: Record<string, unknown>) {
    return this.createYapInput(input)
  }
  yapAttachmentRead(input: { attachmentId: string; offset?: number; limit?: number }) {
    return this.readYapAttachment(input)
  }
  yapProposalList(projectId?: string) {
    return this.listYapProposals(projectId)
  }
  yapProposalRead(proposalId: string) {
    return this.readYapProposal(proposalId)
  }
  yapProposal(input: Record<string, unknown>) {
    return this.saveYapProposal(input)
  }
  yapProposalCancel(proposalId: string, expectedVersion: number) {
    return this.cancelYapProposal(proposalId, expectedVersion)
  }
  yapProposalApprove(input: Record<string, unknown>) {
    return this.approveYapProposal(input)
  }
  yapProposalApply(input: Record<string, unknown>) {
    return this.applyYapProposal(input)
  }
}

export async function configuredProjectRecordsClient(
  env = process.env,
): Promise<ProjectRecordsClient> {
  const endpoint = env.FLAPSTACK_PROJECT_RECORDS_URL
  if (!endpoint)
    throw new Error("Project records is not connected. Configure the local records service.")
  projectRecordsEndpoint(endpoint)
  let token = env.FLAPSTACK_PROJECT_RECORDS_TOKEN?.trim()
  if (!token && env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE) {
    let file
    try {
      file = await open(env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE, "r")
      const bytes = Buffer.alloc(MAX_TOKEN_BYTES + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead > MAX_TOKEN_BYTES) throw new Error("Token file is too large")
      token = bytes.subarray(0, bytesRead).toString("utf8").trim()
    } catch {
      throw new Error("Project records authentication file could not be read.")
    } finally {
      await file?.close()
    }
  }
  return new ProjectRecordsClient({ endpoint, token: token ?? "" })
}
