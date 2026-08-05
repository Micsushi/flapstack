import { randomUUID } from "node:crypto"
import { z } from "zod"

const sourceKindSchema = z.enum(["screen", "window", "application-window", "region"])
const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("agent"), id: z.string().min(1).max(200) }).strict(),
])
const scopeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200).optional(),
    chatId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
  })
  .strict()
const approvalSchema = z
  .object({
    id: z.string().min(1).max(200),
    actorId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200).optional(),
    chatId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
    expiresAt: z.number().int().positive(),
  })
  .strict()

export type VisualCaptureActor = z.infer<typeof actorSchema>
export type VisualCaptureScope = z.infer<typeof scopeSchema>
export type VisualCaptureSource = {
  id: string
  kind: z.infer<typeof sourceKindSchema>
  label: string
  displayId: string | null
  previewDataUrl?: string
}

export interface VisualCaptureProvider {
  enumerate(): Promise<VisualCaptureSource[]>
  capture(sourceId: string): Promise<{
    bytes: Buffer
    sourceId: string
    scaleFactor: number
  }>
  discard?(sourceIds: string[]): void | Promise<void>
}

type Session = {
  id: string
  actor: VisualCaptureActor
  scope: VisualCaptureScope
  approvalId: string | null
  createdAt: number
  expiresAt: number
  sourceRevision: number
  sources: Map<string, z.infer<typeof sourceKindSchema>>
  selectedSourceId: string | null
}

export class VisualCaptureSessionService {
  readonly #sessions = new Map<string, Session>()
  readonly #provider: VisualCaptureProvider
  readonly #now: () => number
  readonly #timeoutMs: number

  constructor(
    provider: VisualCaptureProvider,
    now: () => number = Date.now,
    options: { timeoutMs?: number } = {},
  ) {
    this.#provider = provider
    this.#now = now
    this.#timeoutMs = options.timeoutMs ?? 5 * 60_000
  }

  begin(value: {
    actor: VisualCaptureActor
    visibleUserInitiation: boolean
    scope: VisualCaptureScope
    approval?: z.infer<typeof approvalSchema>
  }): { id: string; expiresAt: number; approvalId: string | null } {
    const actor = actorSchema.parse(value.actor)
    const scope = scopeSchema.parse(value.scope)
    const now = this.#now()
    let approvalId: string | null = null
    if (actor.kind === "user") {
      if (!value.visibleUserInitiation) {
        throw new Error("Visual capture requires visible user initiation.")
      }
    } else {
      if (value.visibleUserInitiation) {
        throw new Error("An agent cannot claim visible user initiation.")
      }
      const approval = approvalSchema.safeParse(value.approval)
      if (
        !approval.success ||
        approval.data.actorId !== actor.id ||
        approval.data.expiresAt <= now ||
        !sameScope(scope, approval.data)
      ) {
        throw new Error("Visual capture requires a live exact-scope agent approval.")
      }
      approvalId = approval.data.id
    }

    const id = randomUUID()
    const expiresAt = Math.min(
      now + this.#timeoutMs,
      value.approval?.expiresAt ?? Number.MAX_SAFE_INTEGER,
    )
    this.#sessions.set(id, {
      id,
      actor,
      scope,
      approvalId,
      createdAt: now,
      expiresAt,
      sourceRevision: 0,
      sources: new Map(),
      selectedSourceId: null,
    })
    return { id, expiresAt, approvalId }
  }

  async listSources(id: string): Promise<VisualCaptureSource[]> {
    const session = this.#getActive(id)
    this.#discard([...session.sources.keys()])
    session.sources.clear()
    session.selectedSourceId = null
    const sourceRevision = ++session.sourceRevision
    const enumerated = await this.#provider.enumerate()
    let sources: VisualCaptureSource[]
    try {
      if (this.#sessions.get(id) !== session) {
        throw new Error("Visual capture request is not active.")
      }
      if (session.sourceRevision !== sourceRevision) {
        throw new Error("Visual capture source refresh was superseded.")
      }
      this.#getActive(id)
      sources = enumerated.map((source) => {
        const previewDataUrl = z
          .string()
          .startsWith("data:image/png;base64,")
          .max(48 * 1_048_576)
          .optional()
          .parse(source.previewDataUrl)
        return {
          id: z.string().min(1).max(500).parse(source.id),
          kind: sourceKindSchema.parse(source.kind),
          label: z.string().min(1).max(500).parse(source.label),
          displayId: z.string().max(200).nullable().parse(source.displayId),
          ...(previewDataUrl ? { previewDataUrl } : {}),
        }
      })
    } catch (error) {
      this.#discard(
        enumerated.map((source) => source.id).filter((value) => typeof value === "string"),
      )
      throw error
    }
    session.sources = new Map(sources.map((source) => [source.id, source.kind]))
    return sources
  }

  selectSource(id: string, sourceId: string, selector: VisualCaptureActor): void {
    const session = this.#getActive(id)
    const parsedSelector = actorSchema.parse(selector)
    if (parsedSelector.kind !== "user") {
      throw new Error("A user must select the exact visual capture source.")
    }
    if (session.actor.kind === "user" && parsedSelector.id !== session.actor.id) {
      throw new Error("The initiating user must select the exact visual capture source.")
    }
    if (!session.sources.has(sourceId)) {
      throw new Error("Visual capture source is not in the current visible selection set.")
    }
    session.selectedSourceId = sourceId
  }

  async capture(id: string): Promise<{
    bytes: Buffer
    sourceId: string
    scaleFactor: number
    sourceClass: z.infer<typeof sourceKindSchema>
    actor: VisualCaptureActor
    scope: VisualCaptureScope
    approvalId: string | null
    capturedAt: number
  }> {
    const session = this.#getActive(id)
    if (!session.selectedSourceId) {
      throw new Error("Select a visible visual capture source before capture.")
    }
    this.#sessions.delete(id)
    const selectedSourceId = session.selectedSourceId
    let captured
    try {
      captured = await this.#provider.capture(selectedSourceId)
    } finally {
      this.#discard([...session.sources.keys()])
    }
    if (captured.sourceId !== session.selectedSourceId) {
      throw new Error("Capture provider returned a frame for a different source.")
    }
    if (!Buffer.isBuffer(captured.bytes) || captured.bytes.byteLength === 0) {
      throw new Error("Capture provider returned an empty frame.")
    }
    if (!Number.isFinite(captured.scaleFactor) || captured.scaleFactor <= 0) {
      throw new Error("Capture provider returned an invalid display scale.")
    }
    return {
      ...captured,
      sourceClass: session.sources.get(session.selectedSourceId)!,
      actor: session.actor,
      scope: session.scope,
      approvalId: session.approvalId,
      capturedAt: this.#now(),
    }
  }

  cancel(id: string): void {
    const session = this.#sessions.get(id)
    this.#sessions.delete(id)
    if (session) this.#discard([...session.sources.keys()])
  }

  #getActive(id: string): Session {
    const session = this.#sessions.get(id)
    if (!session) throw new Error("Visual capture request is not active.")
    if (this.#now() >= session.expiresAt) {
      this.#sessions.delete(id)
      this.#discard([...session.sources.keys()])
      throw new Error("Visual capture request expired.")
    }
    return session
  }

  #discard(sourceIds: string[]): void {
    if (sourceIds.length === 0 || !this.#provider.discard) return
    void Promise.resolve(this.#provider.discard(sourceIds)).catch(() => undefined)
  }
}

function sameScope(scope: VisualCaptureScope, approval: z.infer<typeof approvalSchema>): boolean {
  return (
    scope.projectId === approval.projectId &&
    scope.taskId === approval.taskId &&
    scope.chatId === approval.chatId &&
    scope.runId === approval.runId
  )
}
