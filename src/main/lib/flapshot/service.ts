import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { and, desc, eq } from "drizzle-orm"
import { app } from "electron"
import { attachments, chats, flapshotOperations, getDatabase, projects } from "../db"
import {
  assertServiceResponseCorrelation,
  assertOperationResponseBinding,
  deriveFlapshotActions,
  buildRecordingStartInput,
  flapshotAuthorizedFileReferenceSchema,
  flapshotFileReferenceSchema,
  FLAPSHOT_TOOLS,
  operationAcceptedResponseSchema,
  operationGetResponseSchema,
  parseToolStructuredContent,
  recordingCapabilitiesResponseSchema,
  recordingTargetsResponseSchema,
  runtimeRecordingAvailability,
  runtimeScreenshotAvailability,
  screenshotCapabilitiesResponseSchema,
  FLAPSHOT_RECORDING_LIMITS,
  screenshotTargetsResponseSchema,
  throwIfServiceFailure,
  type FlapshotActionAvailability,
  type FlapshotFileReference,
  type FlapshotOperationSnapshot,
  type FlapshotRecordingTarget,
} from "./contracts"
import {
  FlapshotMcpClientManager,
  readMcpResourceText,
  safeMcpError,
  type FlapshotProtocolClient,
} from "./client"
import {
  flapshotArtifactResourceUri,
  validateFlapshotFileReference,
  validateFlapshotResourceUri,
  verifyStoredFlapshotFile,
} from "./integrity"
import { resolveStoredOperationScope } from "./lifecycle"

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "timed-out", "interrupted"])
const MONITOR_INTERVAL_MS = 1_000

interface ChatScope {
  chatId: string
  taskId: string | null
  projectPath: string | null
  connectionKey: string
}

type StoredFlapshotOperation = typeof flapshotOperations.$inferSelect
type NewAttachment = typeof attachments.$inferInsert

export function flapshotAttachmentId(operationId: string): string {
  return `flapshot-${createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`
}

export async function ensureFlapshotStoredCopy(input: {
  storageRoot: string
  attachmentId: string
  name: string
  sourcePath: string
  sizeBytes: number
  sha256: string
  mimeType: string
}): Promise<string> {
  const storageDir = join(input.storageRoot, input.attachmentId)
  await mkdir(storageDir, { recursive: true })
  for (const entry of await readdir(storageDir)) {
    if (entry.startsWith(".flapstack-") && entry.endsWith(".tmp")) {
      await rm(join(storageDir, entry), { force: true })
    }
  }
  const storedPath = join(storageDir, input.name)
  const existing = await verifyStoredFlapshotFile({
    filePath: storedPath,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    mimeType: input.mimeType,
    grantExpiresAt: null,
  })
  if (existing.status === "verified") return storedPath

  const temporaryPath = join(storageDir, `.flapstack-${randomUUID()}.tmp`)
  try {
    await copyFile(input.sourcePath, temporaryPath)
    const copiedHash = await hashFile(temporaryPath)
    if (copiedHash !== input.sha256) throw new Error("Copied attachment hash changed")
    await rename(temporaryPath, storedPath)
    return storedPath
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export function commitFlapshotAttachment(input: {
  operationId: string
  attachment: NewAttachment
}): string {
  const db = getDatabase()
  return db.transaction((tx) => {
    const operation = tx
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.operationId, input.operationId))
      .get()
    if (!operation) throw new Error("Flapshot operation disappeared during attachment ingestion")

    tx.insert(attachments).values(input.attachment).onConflictDoNothing().run()
    const attachment = tx
      .select()
      .from(attachments)
      .where(eq(attachments.operationId, input.operationId))
      .get()
    if (
      !attachment ||
      attachment.chatId !== operation.chatId ||
      attachment.taskId !== operation.taskId ||
      attachment.sha256 !== input.attachment.sha256 ||
      attachment.byteLength !== input.attachment.byteLength
    ) {
      throw new Error("Flapshot attachment conflicts with an existing operation result")
    }
    if (operation.resultAttachmentId && operation.resultAttachmentId !== attachment.id) {
      throw new Error("Flapshot operation is already linked to another attachment")
    }
    tx.update(flapshotOperations)
      .set({ resultAttachmentId: attachment.id, updatedAt: new Date() })
      .where(eq(flapshotOperations.operationId, input.operationId))
      .run()
    return attachment.id
  })
}

function getChatScope(chatId: string, clients: FlapshotMcpClientManager): ChatScope {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")
  const project = chat.projectId
    ? db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
    : null
  return {
    chatId,
    taskId: chat.taskId,
    projectPath: project?.path ?? null,
    connectionKey: clients.connectionKey(project?.path ?? null),
  }
}

async function callTool(
  client: FlapshotProtocolClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 30_000 })
  const structured = parseToolStructuredContent(result)
  throwIfServiceFailure(structured)
  if (typeof args.requestId === "string") {
    assertServiceResponseCorrelation(structured, args.requestId)
  }
  return structured
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png"
    case "image/jpeg":
      return ".jpg"
    case "image/webp":
      return ".webp"
    case "video/mp4":
      return ".mp4"
    case "video/webm":
      return ".webm"
    default:
      throw new Error("Unsupported Flapshot attachment MIME type")
  }
}

function safeAttachmentName(
  value: string | undefined,
  fallback: string,
  extension: string,
): string {
  if (!value) return fallback
  const cleaned = basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback
  if (extname(cleaned).toLowerCase() !== extension) return fallback
  if (Buffer.byteLength(cleaned) > 240) return fallback
  return cleaned
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

function provenanceFor(snapshot: FlapshotOperationSnapshot) {
  const result = snapshot.terminal?.state === "succeeded" ? snapshot.terminal.result : null
  const artifact = result?.artifact
  return {
    sourceApplication: artifact?.sourceApplication ?? "Flapshot",
    sourceArtifactId: artifact?.id ?? result?.file?.artifactId ?? null,
    name: artifact?.name,
    provenance: artifact?.provenance ?? {
      kind: result?.kind ?? "operation",
      producer: "flapshot-mcp",
      producerContractVersion: null,
      requestId: snapshot.requestId,
      metadata: {},
    },
  }
}

function fileReferenceFor(snapshot: FlapshotOperationSnapshot): FlapshotFileReference {
  if (snapshot.terminal?.state !== "succeeded")
    throw new Error("Flapshot operation did not succeed")
  const parsed = flapshotFileReferenceSchema.safeParse(snapshot.terminal.result.file)
  if (!parsed.success) throw new Error("Flapshot operation returned no valid local file reference")
  return parsed.data
}

export class FlapshotService {
  private readonly clients: FlapshotMcpClientManager
  private readonly monitors = new Map<string, NodeJS.Timeout>()
  private readonly ingestions = new Map<string, Promise<void>>()

  constructor(clients?: FlapshotMcpClientManager) {
    this.clients =
      clients ??
      new FlapshotMcpClientManager(undefined, (connectionKey, error) => {
        this.markDisconnected(connectionKey, error)
      })
  }

  async status(chatId: string) {
    const scope = getChatScope(chatId, this.clients)
    const status = await this.clients.status(scope.projectPath)
    const actions: Record<"screenshot" | "recording", FlapshotActionAvailability> = status.discovery
      ? deriveFlapshotActions(status.discovery)
      : {
          screenshot: { available: false, reason: status.error ?? "Flapshot is unavailable" },
          recording: { available: false, reason: status.error ?? "Flapshot is unavailable" },
        }
    if (!status.pairingStatusSupported) {
      const reason = "Flapshot MCP does not expose exact live pairing status"
      actions.screenshot = { available: false, reason }
      actions.recording = { available: false, reason }
    } else if (!status.auth?.paired) {
      const reason = status.auth?.pairingCode
        ? `Pair code ${status.auth.pairingCode} in Flapshot Agent access`
        : (status.error ?? "Flapshot pairing status is unavailable")
      actions.screenshot = { available: false, reason }
      actions.recording = { available: false, reason }
    }
    if (status.connected && status.auth?.paired) {
      const client = await this.clients.client(scope.projectPath)
      const probes: Array<Promise<void>> = []
      if (actions.screenshot.available) {
        probes.push(
          callTool(client, FLAPSHOT_TOOLS.screenshotCapabilities, {
            requestId: `flapstack-screenshot-capabilities-${randomUUID()}`,
          })
            .then((value) => {
              const capabilities = screenshotCapabilitiesResponseSchema.parse(value).data
              actions.screenshot = runtimeScreenshotAvailability(capabilities)
            })
            .catch((error) => {
              actions.screenshot = {
                available: false,
                reason: `Screenshot capability check failed: ${safeMcpError(error)}`,
              }
            }),
        )
      }
      if (actions.recording.available) {
        probes.push(
          callTool(client, FLAPSHOT_TOOLS.recordingCapabilities, {
            requestId: `flapstack-recording-capabilities-${randomUUID()}`,
          })
            .then((value) => {
              const capabilities = recordingCapabilitiesResponseSchema.parse(value).data
              actions.recording = runtimeRecordingAvailability(capabilities)
            })
            .catch((error) => {
              actions.recording = {
                available: false,
                reason: `Recording capability check failed: ${safeMcpError(error)}`,
              }
            }),
        )
      }
      await Promise.all(probes)
    }
    if (status.connected && status.auth?.paired) this.resumeMonitors(scope)
    return {
      platform: process.platform,
      configured: status.configured,
      connected: status.connected,
      serverVersion: status.serverVersion,
      paired: status.pairingStatusSupported ? (status.auth?.paired ?? false) : null,
      pairingStatusSupported: status.pairingStatusSupported,
      connectionId: status.auth?.connectionId ?? null,
      pairingCode: status.auth?.pairingCode ?? null,
      error: status.error,
      actions,
    }
  }

  async captureScreenshot(chatId: string) {
    const scope = getChatScope(chatId, this.clients)
    const status = await this.status(chatId)
    if (!status.actions.screenshot.available) throw new Error(status.actions.screenshot.reason)
    const client = await this.clients.client(scope.projectPath)
    const targetsValue = await callTool(client, FLAPSHOT_TOOLS.screenshotTargets, {
      requestId: `flapstack-targets-${randomUUID()}`,
    })
    const targets = screenshotTargetsResponseSchema.parse(targetsValue)
    const display = targets.data.displays[0]
    if (!display) throw new Error("Flapshot reported no screenshot display target")

    const requestId = `flapstack-screenshot-${randomUUID()}`
    const value = await callTool(client, FLAPSHOT_TOOLS.screenshotCapture, {
      requestId,
      idempotencyKey: requestId,
      timeoutMs: 120_000,
      target: { kind: "display", displayId: display.id },
      contentPolicy: {
        cursor: "exclude",
        outsideDisplays: "reject",
        windowFrame: "include-frame-exclude-shadow",
        protectedContent: "fail-empty-or-protected",
      },
    })
    const accepted = operationAcceptedResponseSchema.parse(value)
    this.storeAccepted(scope, "screenshot", accepted.data.operation)
    this.startMonitor(scope, accepted.data.operation.operationId)
    return accepted.data.operation
  }

  async startRecording(chatId: string) {
    const scope = getChatScope(chatId, this.clients)
    const status = await this.status(chatId)
    if (!status.actions.recording.available) throw new Error(status.actions.recording.reason)
    const client = await this.clients.client(scope.projectPath)
    const [capabilitiesValue, targetsValue] = await Promise.all([
      callTool(client, FLAPSHOT_TOOLS.recordingCapabilities, {
        requestId: `flapstack-recording-capabilities-${randomUUID()}`,
      }),
      callTool(client, FLAPSHOT_TOOLS.recordingTargets, {
        requestId: `flapstack-recording-targets-${randomUUID()}`,
      }),
    ])
    const capabilities = recordingCapabilitiesResponseSchema.parse(capabilitiesValue).data
    const targets = recordingTargetsResponseSchema.parse(targetsValue).data
    const target = targets.targets.find(
      (candidate): candidate is Extract<FlapshotRecordingTarget, { kind: "display" }> =>
        candidate.kind === "display" && capabilities.targets.display.supported,
    )
    if (!target) throw new Error("Flapshot reported no supported recording display target")
    if (!capabilities.permissions.screen.supported) {
      throw new Error(
        capabilities.permissions.screen.remediation ??
          capabilities.permissions.screen.reason ??
          "Flapshot screen-recording permission is unavailable",
      )
    }

    const requestId = `flapstack-recording-${randomUUID()}`
    const recordingInput = buildRecordingStartInput(target, capabilities.cursor.system.supported)
    const value = await callTool(client, FLAPSHOT_TOOLS.recordingStart, {
      requestId,
      idempotencyKey: requestId,
      timeoutMs: FLAPSHOT_RECORDING_LIMITS.maxDurationMs,
      ...recordingInput,
    })
    const accepted = operationAcceptedResponseSchema.parse(value)
    this.storeAccepted(scope, "recording", accepted.data.operation)
    this.startMonitor(scope, accepted.data.operation.operationId)
    return accepted.data.operation
  }

  async stopRecording(chatId: string, operationId: string) {
    const scope = this.ownedOperationScope(chatId, operationId)
    const client = await this.clients.client(scope.projectPath)
    await callTool(client, FLAPSHOT_TOOLS.recordingStop, {
      requestId: `flapstack-stop-${randomUUID()}`,
      operationId,
    })
    this.startMonitor(scope, operationId)
    return { operationId, state: "stopping" }
  }

  async cancelOperation(chatId: string, operationId: string) {
    const scope = this.ownedOperationScope(chatId, operationId)
    const client = await this.clients.client(scope.projectPath)
    const result = await callTool(client, FLAPSHOT_TOOLS.operationCancel, {
      requestId: `flapstack-cancel-${randomUUID()}`,
      operationId,
    })
    getDatabase()
      .update(flapshotOperations)
      .set({ state: "cancelling", updatedAt: new Date() })
      .where(eq(flapshotOperations.operationId, operationId))
      .run()
    this.startMonitor(scope, operationId)
    return result
  }

  async restart(chatId: string) {
    const scope = getChatScope(chatId, this.clients)
    this.markDisconnected(scope.connectionKey)
    const status = await this.clients.restart(scope.projectPath)
    if (status.connected && status.auth?.paired) await this.reconcile(scope)
    return this.status(chatId)
  }

  async listOperations(chatId: string) {
    const scope = getChatScope(chatId, this.clients)
    this.resumeMonitors(scope)
    return getDatabase()
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.chatId, chatId))
      .orderBy(desc(flapshotOperations.createdAt))
      .limit(20)
      .all()
  }

  async verifyAttachment(chatId: string, attachmentId: string) {
    const db = getDatabase()
    const attachment = db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.chatId, chatId)))
      .get()
    if (!attachment || attachment.sourceApplication !== "Flapshot") {
      throw new Error("Flapshot attachment not found")
    }
    const result = await verifyStoredFlapshotFile({
      filePath: attachment.storedPath ?? attachment.sourcePath,
      sizeBytes: attachment.byteLength,
      sha256: attachment.sha256,
      mimeType: attachment.mimeType,
      grantExpiresAt: attachment.storedPath ? null : attachment.grantExpiresAt,
    })
    db.update(attachments)
      .set({ integrityStatus: result.status })
      .where(eq(attachments.id, attachmentId))
      .run()
    return result
  }

  async shutdown(): Promise<void> {
    for (const timer of this.monitors.values()) clearTimeout(timer)
    this.monitors.clear()
    await this.clients.closeAll()
  }

  private ownedOperationScope(chatId: string, operationId: string): ChatScope {
    const scope = getChatScope(chatId, this.clients)
    const operation = getDatabase()
      .select()
      .from(flapshotOperations)
      .where(
        and(eq(flapshotOperations.operationId, operationId), eq(flapshotOperations.chatId, chatId)),
      )
      .get()
    if (!operation) throw new Error("Flapshot operation not found for this chat")
    return scope
  }

  private storeAccepted(scope: ChatScope, kind: string, snapshot: FlapshotOperationSnapshot) {
    const db = getDatabase()
    db.insert(flapshotOperations)
      .values({
        operationId: snapshot.operationId,
        chatId: scope.chatId,
        taskId: scope.taskId,
        connectionKey: scope.connectionKey,
        kind,
        state: snapshot.state,
        requestId: snapshot.requestId,
        correlationId: snapshot.correlationId,
        auditCorrelationId: snapshot.auditCorrelationId,
        clientId: snapshot.clientId,
        sessionId: snapshot.sessionId,
        progressCompleted: Math.floor(snapshot.progress.completed),
        progressTotal:
          snapshot.progress.total === null ? null : Math.floor(snapshot.progress.total),
        progressUnit: snapshot.progress.unit,
        progressMessage: snapshot.progress.message,
      })
      .onConflictDoNothing()
      .run()
    const stored = db
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.operationId, snapshot.operationId))
      .get()
    if (
      !stored ||
      stored.chatId !== scope.chatId ||
      stored.taskId !== scope.taskId ||
      stored.connectionKey !== scope.connectionKey ||
      stored.requestId !== snapshot.requestId ||
      stored.clientId !== snapshot.clientId ||
      stored.sessionId !== snapshot.sessionId
    ) {
      throw new Error("Flapshot accepted operation conflicts with an existing owner")
    }
  }

  private startMonitor(scope: ChatScope, operationId: string) {
    if (this.monitors.has(operationId)) return
    const run = async () => {
      try {
        const terminal = await this.refreshOperation(scope, operationId)
        if (terminal) {
          this.monitors.delete(operationId)
          return
        }
        this.monitors.set(operationId, setTimeout(run, MONITOR_INTERVAL_MS))
      } catch (error) {
        this.monitors.delete(operationId)
        this.markOperationInterrupted(operationId, "CLIENT_DISCONNECTED", safeMcpError(error))
      }
    }
    this.monitors.set(operationId, setTimeout(run, 0))
  }

  private resumeMonitors(scope: ChatScope) {
    const rows = getDatabase()
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.connectionKey, scope.connectionKey))
      .all()
    for (const row of rows) {
      if (
        !TERMINAL_STATES.has(row.state) ||
        (row.state === "succeeded" && !row.resultAttachmentId)
      ) {
        try {
          this.startMonitor(this.scopeForStoredOperation(row), row.operationId)
        } catch (error) {
          this.markOperationInterrupted(row.operationId, "SCOPE_MISMATCH", safeMcpError(error))
        }
      }
    }
  }

  private async reconcile(scope: ChatScope) {
    const rows = getDatabase()
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.connectionKey, scope.connectionKey))
      .all()
    await Promise.allSettled(
      rows
        .filter((row) => !TERMINAL_STATES.has(row.state))
        .map(async (row) =>
          this.refreshOperation(this.scopeForStoredOperation(row), row.operationId),
        ),
    )
  }

  private scopeForStoredOperation(row: StoredFlapshotOperation): ChatScope {
    return resolveStoredOperationScope(row, (chatId) => getChatScope(chatId, this.clients))
  }

  private async refreshOperation(scope: ChatScope, operationId: string): Promise<boolean> {
    const stored = getDatabase()
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.operationId, operationId))
      .get()
    if (!stored || stored.chatId !== scope.chatId || stored.connectionKey !== scope.connectionKey) {
      throw new Error("Flapshot operation refresh scope does not match its stored owner")
    }
    const client = await this.clients.client(scope.projectPath)
    const value = await callTool(client, FLAPSHOT_TOOLS.operationGet, {
      requestId: `flapstack-operation-${randomUUID()}`,
      operationId,
    })
    const response = operationGetResponseSchema.parse(value)
    assertOperationResponseBinding(response, stored)
    const snapshot = response.data
    if (!snapshot) {
      this.markOperationInterrupted(
        operationId,
        "APP_RESTARTED",
        "Flapshot operation was not found",
      )
      return true
    }
    const terminal = TERMINAL_STATES.has(snapshot.state)
    const error = snapshot.terminal?.state !== "succeeded" ? snapshot.terminal?.error : null
    getDatabase()
      .update(flapshotOperations)
      .set({
        state: snapshot.state,
        correlationId: snapshot.correlationId,
        auditCorrelationId: snapshot.auditCorrelationId,
        progressCompleted: Math.floor(snapshot.progress.completed),
        progressTotal:
          snapshot.progress.total === null ? null : Math.floor(snapshot.progress.total),
        progressUnit: snapshot.progress.unit,
        progressMessage: snapshot.progress.message,
        errorCode: error?.code ?? null,
        errorReason: error?.reason ?? null,
        errorMessage: error?.message ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(flapshotOperations.operationId, operationId),
          eq(flapshotOperations.chatId, stored.chatId),
        ),
      )
      .run()

    if (snapshot.state === "succeeded") {
      try {
        await this.ingestResultOnce(scope, snapshot, client)
      } catch (error) {
        getDatabase()
          .update(flapshotOperations)
          .set({
            state: "failed",
            errorCode: "ATTACHMENT_INGEST_FAILED",
            errorReason: "INTEGRITY_OR_IO_FAILED",
            errorMessage: safeMcpError(error),
            updatedAt: new Date(),
          })
          .where(eq(flapshotOperations.operationId, operationId))
          .run()
        return true
      }
    }
    return terminal
  }

  private async ingestResultOnce(
    scope: ChatScope,
    snapshot: FlapshotOperationSnapshot,
    client: FlapshotProtocolClient,
  ) {
    const active = this.ingestions.get(snapshot.operationId)
    if (active) return active
    const ingestion = this.ingestResult(scope, snapshot, client).finally(() => {
      if (this.ingestions.get(snapshot.operationId) === ingestion) {
        this.ingestions.delete(snapshot.operationId)
      }
    })
    this.ingestions.set(snapshot.operationId, ingestion)
    return ingestion
  }

  private async ingestResult(
    scope: ChatScope,
    snapshot: FlapshotOperationSnapshot,
    client: FlapshotProtocolClient,
  ) {
    const db = getDatabase()
    const operation = db
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.operationId, snapshot.operationId))
      .get()
    if (!operation || operation.resultAttachmentId) return

    let reference = fileReferenceFor(snapshot)
    let sourceUri: string | null = null
    if (reference.kind === "managed-artifact" && reference.artifactId) {
      sourceUri = flapshotArtifactResourceUri(reference.artifactId)
      validateFlapshotResourceUri(sourceUri, reference.artifactId)
      const resource = await client.readResource({ uri: sourceUri })
      const text = readMcpResourceText(resource)
      const resourceReference = flapshotAuthorizedFileReferenceSchema.parse(JSON.parse(text))
      if (
        resourceReference.artifactId !== reference.artifactId ||
        resourceReference.mimeType !== reference.mimeType ||
        resourceReference.sizeBytes !== reference.sizeBytes ||
        resourceReference.sha256.toLowerCase() !== reference.sha256.toLowerCase()
      ) {
        throw new Error("Flapshot file-reference resource did not match the operation result")
      }
      reference = resourceReference
    }

    const authorizedReference = flapshotAuthorizedFileReferenceSchema.parse(reference)
    const validated = await validateFlapshotFileReference(authorizedReference, snapshot.clientId)
    const provenance = provenanceFor(snapshot)
    const extension = extensionForMime(validated.mimeType)
    const fallbackName = `flapshot-${operation.kind}-${snapshot.operationId}${extension}`
    const name = safeAttachmentName(provenance.name, fallbackName, extension)
    const provenanceJson = JSON.stringify(provenance.provenance)
    if (Buffer.byteLength(provenanceJson) > 16 * 1024) {
      throw new Error("Flapshot provenance exceeds the attachment metadata limit")
    }
    const attachmentId = flapshotAttachmentId(snapshot.operationId)
    let storedPath: string | null = null

    if (validated.copyIntoFlapstack) {
      storedPath = await ensureFlapshotStoredCopy({
        storageRoot: join(app.getPath("userData"), "attachments"),
        attachmentId,
        name: `result${extension}`,
        sourcePath: validated.canonicalPath,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        mimeType: validated.mimeType,
      })
    }

    try {
      commitFlapshotAttachment({
        operationId: snapshot.operationId,
        attachment: {
          id: attachmentId,
          chatId: scope.chatId,
          taskId: scope.taskId,
          kind: validated.mimeType.startsWith("image/") ? "image" : "file",
          name,
          sourcePath: validated.canonicalPath,
          storedPath,
          mimeType: validated.mimeType,
          byteLength: validated.sizeBytes,
          sha256: validated.sha256,
          sourceArtifactId: provenance.sourceArtifactId,
          sourceUri,
          sourceApplication: "Flapshot",
          grantClientId: authorizedReference.local.grantedToClientId,
          grantExpiresAt: authorizedReference.local.expiresAt ?? null,
          provenanceJson,
          integrityStatus: "verified",
          operationId: snapshot.operationId,
          correlationId: snapshot.correlationId,
          auditCorrelationId: snapshot.auditCorrelationId,
        },
      })
    } catch (error) {
      const committed = db
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.operationId, snapshot.operationId))
        .get()
      if (storedPath && !committed) {
        await rm(join(app.getPath("userData"), "attachments", attachmentId), {
          recursive: true,
          force: true,
        })
      }
      throw error
    }
  }

  private markDisconnected(connectionKey: string, error?: Error) {
    const db = getDatabase()
    const rows = db
      .select()
      .from(flapshotOperations)
      .where(eq(flapshotOperations.connectionKey, connectionKey))
      .all()
    for (const row of rows) {
      if (TERMINAL_STATES.has(row.state)) continue
      this.markOperationInterrupted(
        row.operationId,
        "CLIENT_DISCONNECTED",
        error ? safeMcpError(error) : "Flapshot MCP disconnected",
      )
    }
  }

  private markOperationInterrupted(operationId: string, code: string, message: string) {
    const timer = this.monitors.get(operationId)
    if (timer) clearTimeout(timer)
    this.monitors.delete(operationId)
    getDatabase()
      .update(flapshotOperations)
      .set({
        state: "interrupted",
        errorCode: code,
        errorReason: code === "APP_RESTARTED" ? "PROCESS_RESTARTED" : "SESSION_ENDED",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(flapshotOperations.operationId, operationId))
      .run()
  }
}

export const flapshotService = new FlapshotService()
