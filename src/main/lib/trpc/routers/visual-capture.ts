import { app, dialog } from "electron"
import { join } from "node:path"
import sharp from "sharp"
import { z } from "zod"
import { getSqliteDatabase } from "../../db"
import { VisualArtifactStore } from "../../visual-capture/artifact-store"
import {
  createVisualCaptureDerivative,
  visualCaptureEditSchema,
} from "../../visual-capture/derivative"
import { ElectronVisualCaptureProvider } from "../../visual-capture/electron-provider"
import { appVisualCapturePendingStore } from "../../visual-capture/pending-store"
import { VisualCaptureSessionService } from "../../visual-capture/session"
import { publicProcedure, router } from "../index"

const pending = appVisualCapturePendingStore
let service: VisualCaptureSessionService | null = null

function captureService(): VisualCaptureSessionService {
  service ??= new VisualCaptureSessionService(new ElectronVisualCaptureProvider())
  return service
}

function artifactStore(): VisualArtifactStore {
  return new VisualArtifactStore(
    getSqliteDatabase(),
    join(app.getPath("userData"), "visual-artifacts"),
  )
}

const scopeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    taskId: z.string().min(1).max(200).optional(),
    chatId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
  })
  .strict()

export const visualCaptureRouter = router({
  beginUser: publicProcedure
    .input(z.object({ scope: scopeSchema }).strict())
    .mutation(({ input }) =>
      captureService().begin({
        actor: { kind: "user", id: "owner" },
        visibleUserInitiation: true,
        scope: input.scope,
      }),
    ),

  beginApprovedAgent: publicProcedure
    .input(z.object({ captureRequestId: z.string().uuid() }).strict())
    .mutation(({ input }) => {
      const database = getSqliteDatabase()
      const approval = database
        .transaction(() => {
          const row = database
            .prepare(
              `SELECT p.id AS approvalId, p.caller_chat_id AS chatId,
                    p.caller_run_id AS runId, p.expires_at AS expiresAt,
                    c.project_id AS projectId
               FROM mcp_approval_requests p
               JOIN chats c ON c.id = p.caller_chat_id
               JOIN agent_runs r ON r.id = p.caller_run_id AND r.chat_id = c.id
              WHERE p.invocation_id = ?
                AND p.tool_name = 'request_visual_capture'
                AND p.decision = 'approve'
                AND p.expires_at > unixepoch()
                AND EXISTS (
                  SELECT 1 FROM visual_capture_audit a
                   WHERE a.request_id = p.invocation_id
                     AND a.action = 'request'
                     AND a.actor_kind = 'agent'
                     AND a.actor_id = p.caller_run_id
                     AND a.project_id = c.project_id
                     AND a.outcome = 'allowed'
                )`,
            )
            .get(input.captureRequestId) as
            | {
                approvalId: string
                chatId: string
                runId: string
                expiresAt: number
                projectId: string
              }
            | undefined
          if (!row)
            throw new Error("Visual capture approval is missing, denied, stale, or expired.")
          const consumed = database
            .prepare(
              `SELECT 1 FROM visual_capture_audit
              WHERE request_id = ? AND action = 'select'`,
            )
            .get(input.captureRequestId)
          if (consumed) throw new Error("Visual capture approval was already consumed.")
          database
            .prepare(
              `INSERT INTO visual_capture_audit
               (artifact_id, request_id, action, actor_kind, actor_id, project_id, outcome, occurred_at)
             VALUES (NULL, ?, 'select', 'user', 'owner', ?, 'allowed', ?)`,
            )
            .run(input.captureRequestId, row.projectId, Date.now())
          return row
        })
        .immediate()
      return captureService().begin({
        actor: { kind: "agent", id: approval.runId },
        visibleUserInitiation: false,
        scope: {
          projectId: approval.projectId,
          chatId: approval.chatId,
          runId: approval.runId,
        },
        approval: {
          id: approval.approvalId,
          actorId: approval.runId,
          projectId: approval.projectId,
          chatId: approval.chatId,
          runId: approval.runId,
          expiresAt: approval.expiresAt * 1_000,
        },
      })
    }),

  approvedAgentRequests: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).max(200),
          chatId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .query(({ input }) => {
      return getSqliteDatabase()
        .prepare(
          `SELECT p.invocation_id AS captureRequestId, p.caller_chat_id AS chatId,
                  p.caller_run_id AS runId, p.expires_at AS expiresAt
             FROM mcp_approval_requests p
             JOIN chats c ON c.id = p.caller_chat_id
            WHERE c.project_id = ?
              AND p.caller_chat_id = ?
              AND p.tool_name = 'request_visual_capture'
              AND p.decision = 'approve'
              AND p.expires_at > unixepoch()
              AND EXISTS (
                SELECT 1 FROM visual_capture_audit requested
                 WHERE requested.request_id = p.invocation_id
                   AND requested.action = 'request'
                   AND requested.outcome = 'allowed'
              )
              AND NOT EXISTS (
                SELECT 1 FROM visual_capture_audit consumed
                 WHERE consumed.request_id = p.invocation_id
                   AND consumed.action = 'select'
              )
            ORDER BY p.created_at, p.id`,
        )
        .all(input.projectId, input.chatId) as Array<{
        captureRequestId: string
        chatId: string
        runId: string
        expiresAt: number
      }>
    }),

  listSources: publicProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .query(({ input }) => captureService().listSources(input.requestId)),

  selectSource: publicProcedure
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          sourceId: z.string().uuid(),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      captureService().selectSource(input.requestId, input.sourceId, {
        kind: "user",
        id: "owner",
      })
      return { selected: true }
    }),

  cancelRequest: publicProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .mutation(({ input }) => {
      captureService().cancel(input.requestId)
      return { cancelled: true }
    }),

  captureSelected: publicProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .mutation(async ({ input }) => {
      const reservation = pending.reserve()
      try {
        const captured = await captureService().capture(input.requestId)
        const resultId = pending.add(reservation, {
          requestId: input.requestId,
          sourceClass: captured.sourceClass,
          bytes: captured.bytes,
          actor: captured.actor,
          scope: captured.scope,
          approvalId: captured.approvalId,
          capturedAt: captured.capturedAt,
          scaleFactor: captured.scaleFactor,
        })
        return {
          resultId,
          capturedAt: captured.capturedAt,
        }
      } catch (error) {
        pending.release(reservation)
        throw error
      }
    }),

  cancelPreview: publicProcedure
    .input(z.object({ resultId: z.string().uuid() }).strict())
    .mutation(({ input }) => {
      pending.cancel(input.resultId)
      return { cancelled: true }
    }),

  previewEdit: publicProcedure
    .input(
      z
        .object({
          resultId: z.string().uuid(),
          edit: visualCaptureEditSchema,
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const captured = pending.get(input.resultId)
      const derivative = await createVisualCaptureDerivative(captured.bytes, input.edit)
      return {
        previewDataUrl: `data:image/png;base64,${derivative.bytes.toString("base64")}`,
        previewSha256: derivative.previewSha256,
        width: derivative.width,
        height: derivative.height,
      }
    }),

  confirm: publicProcedure
    .input(
      z
        .object({
          resultId: z.string().uuid(),
          edit: visualCaptureEditSchema,
          expectedPreviewSha256: z.string().regex(/^[0-9a-f]{64}$/),
          retainedUntil: z.number().int().positive().nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      return pending.consume(input.resultId, async (captured) => {
        const derivative = await createVisualCaptureDerivative(captured.bytes, input.edit)
        if (derivative.previewSha256 !== input.expectedPreviewSha256) {
          throw new Error("Visual capture edits changed after the last exact preview.")
        }
        const initialLinks = [
          ...(captured.scope.chatId
            ? [{ consumerKind: "chat" as const, consumerId: captured.scope.chatId }]
            : []),
          ...(captured.scope.taskId
            ? [{ consumerKind: "task" as const, consumerId: captured.scope.taskId }]
            : []),
          ...(captured.scope.runId
            ? [{ consumerKind: "run" as const, consumerId: captured.scope.runId }]
            : []),
        ]
        const record = await artifactStore().confirm({
          requestId: captured.requestId,
          sourceClass: input.edit.crop ? "region" : captured.sourceClass,
          actor: captured.actor,
          scope: captured.scope,
          approvalId: captured.approvalId,
          capturedAt: captured.capturedAt,
          scaleFactor: captured.scaleFactor,
          derivative,
          retainedUntil: input.retainedUntil,
          initialLinks,
        })
        return {
          record,
          dataUrl: `data:image/png;base64,${derivative.bytes.toString("base64")}`,
        }
      })
    }),

  history: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).max(200),
          query: z.string().max(200).optional(),
          archived: z.boolean().optional(),
          sourceClass: z.enum(["screen", "window", "application-window", "region"]).optional(),
        })
        .strict(),
    )
    .query(async ({ input }) => {
      const store = artifactStore()
      return Promise.all(
        store.search(input).map(async (record) => ({
          ...record,
          integrityState: (await store.inspect(record.id)).state,
        })),
      )
    }),

  inspect: publicProcedure
    .input(z.object({ artifactId: z.string().uuid() }).strict())
    .query(async ({ input }) => {
      const inspected = await artifactStore().inspect(input.artifactId)
      return { record: inspected.record, state: inspected.state }
    }),

  selectForChat: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          chatId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const store = artifactStore()
      const verified = await store.readVerified(input.artifactId)
      store.link({
        artifactId: input.artifactId,
        consumerKind: "chat",
        consumerId: input.chatId,
      })
      return {
        record: verified.record,
        dataUrl: `data:image/png;base64,${verified.bytes.toString("base64")}`,
      }
    }),

  link: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          consumerKind: z.enum(["chat", "task", "knowledge", "run"]),
          consumerId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      artifactStore().link(input)
      return { linked: true }
    }),

  listLinked: publicProcedure
    .input(
      z
        .object({
          consumerKind: z.enum(["chat", "task", "knowledge", "run"]),
          consumerId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .query(async ({ input }) => {
      const store = artifactStore()
      return Promise.all(
        store.selectedContext(input.consumerKind, input.consumerId).map(async (selected) => {
          const inspected = await store.inspect(selected.id)
          return { ...inspected.record, integrityState: inspected.state }
        }),
      )
    }),

  readLinked: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          consumerKind: z.enum(["chat", "task", "knowledge", "run"]),
          consumerId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .query(async ({ input }) => {
      const store = artifactStore()
      const selected = store
        .selectedContext(input.consumerKind, input.consumerId)
        .some((item) => item.id === input.artifactId)
      if (!selected) throw new Error("Visual artifact is not linked to this consumer.")
      const verified = await store.readVerified(input.artifactId)
      return {
        record: verified.record,
        dataUrl: `data:image/png;base64,${verified.bytes.toString("base64")}`,
      }
    }),

  delete: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          retentionOverride: z.boolean().default(false),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      await artifactStore().deleteIfUnreferenced(input.artifactId, {
        retentionOverride: input.retentionOverride,
      })
      return { deleted: true }
    }),

  archive: publicProcedure
    .input(z.object({ artifactId: z.string().uuid(), archived: z.boolean() }).strict())
    .mutation(({ input }) => artifactStore().archive(input.artifactId, input.archived)),

  setRetention: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          retainedUntil: z.number().int().positive().nullable(),
        })
        .strict(),
    )
    .mutation(({ input }) => artifactStore().setRetention(input.artifactId, input.retainedUntil)),

  move: publicProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          chatId: z.string().min(1).max(200).nullable(),
          taskId: z.string().min(1).max(200).nullable(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      artifactStore().move(input.artifactId, {
        chatId: input.chatId,
        taskId: input.taskId,
      }),
    ),

  importDerivative: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).max(200),
          chatId: z.string().min(1).max(200).optional(),
          taskId: z.string().min(1).max(200).optional(),
          dataBase64: z
            .string()
            .min(1)
            .max(48 * 1_048_576),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      artifactStore().importDerivative({
        projectId: input.projectId,
        ...(input.chatId ? { chatId: input.chatId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        bytes: decodeCanonicalBase64(input.dataBase64),
        actorId: "owner",
      }),
    ),

  exportSelected: publicProcedure
    .input(z.object({ artifactIds: z.array(z.string().uuid()).min(1).max(100) }).strict())
    .mutation(async ({ input }) => {
      const selected = await dialog.showOpenDialog({
        title: "Export confirmed visual derivatives",
        properties: ["openDirectory", "createDirectory"],
      })
      if (selected.canceled || !selected.filePaths[0]) return { cancelled: true, files: [] }
      const files = await artifactStore().exportSelected({
        artifactIds: input.artifactIds,
        destinationRoot: selected.filePaths[0],
        scan: assertMetadataFreePng,
      })
      return { cancelled: false, files }
    }),

  cleanupExpired: publicProcedure.mutation(() => artifactStore().cleanupExpired()),

  auditHistory: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).max(200),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
    )
    .query(({ input }) => artifactStore().auditHistory(input)),
})

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Visual artifact import must use canonical base64.")
  }
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) {
    throw new Error("Visual artifact import must use canonical base64.")
  }
  return bytes
}

async function assertMetadataFreePng(bytes: Buffer): Promise<void> {
  const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 16_000_000 }).metadata()
  if (metadata.format !== "png" || metadata.exif || metadata.icc || metadata.iptc || metadata.xmp) {
    throw new Error("Visual derivative export failed the PNG metadata safety scan.")
  }
}
