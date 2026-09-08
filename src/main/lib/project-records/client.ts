import { open } from "node:fs/promises"
import {
  patchProjectRecordSchema,
  projectRecordIndexSchema,
  projectRecordPathSchema,
  projectRecordSnapshotSchema,
  type ProjectRecordPatch,
  type ProjectRecordWriteResult,
} from "../../../shared/project-records"

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_TOKEN_BYTES = 4096

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

  private async request(path: string, body?: unknown) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000)
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
      if (!response.ok && response.status !== 409) {
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
      return {
        conflict: response.status === 409,
        data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
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
    const response = await this.request("/v1/record", { ...parsed, actor: "owner" })
    const snapshot = projectRecordSnapshotSchema.parse(response.data)
    if (snapshot.path !== input.path)
      throw new Error("Project records returned a different document.")
    return { conflict: response.conflict, snapshot }
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
