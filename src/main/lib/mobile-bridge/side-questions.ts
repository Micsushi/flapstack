import { z } from "zod"
import { eq } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { redactMobileText, type MobileSession } from "../../../shared/mobile-control"
import type { SideQuestion } from "../../../shared/side-questions"
import * as schema from "../db/schema"
import type { MobileScopeGrantService } from "../mobile-events/grants"
import type { MobileSnapshotProjector } from "../mobile-events/projector"
import type { SideQuestionService } from "../side-questions/service"

export const mobileSideQuestionSchema = z
  .object({
    grantId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(200),
    subChatId: z.string().min(1).max(200),
    operation: z.enum(["list", "ask", "retry", "cancel", "promote"]),
    id: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional(),
    question: z.string().trim().min(1).max(8000).optional(),
    before: z.number().int().nonnegative().optional(),
  })
  .strict()
export type MobileSideQuestionRequest = z.infer<typeof mobileSideQuestionSchema>
export type MobileSideQuestionDispatch = (
  session: MobileSession,
  input: MobileSideQuestionRequest,
) => unknown

export function createMobileSideQuestionDispatch(options: {
  database: BetterSQLite3Database<typeof schema>
  grants: Pick<MobileScopeGrantService, "requireActiveGrant">
  projector: Pick<MobileSnapshotProjector, "readResource">
  service: () => Pick<SideQuestionService, "list" | "ask" | "retry" | "cancel" | "promote">
}): MobileSideQuestionDispatch {
  return (session, input) => {
    const grant = options.grants.requireActiveGrant(
      input.grantId,
      session.deviceId,
      session.scopeVersion,
    )
    if (!options.projector.readResource(grant, "chat", input.chatId))
      throw new Error("Conversation unavailable")
    const source = options.database
      .select()
      .from(schema.subChats)
      .where(eq(schema.subChats.id, input.subChatId))
      .get()
    if (!source || source.chatId !== input.chatId) throw new Error("Conversation unavailable")
    if (
      input.operation !== "list" &&
      (!grant.capabilities.includes("chat.send") || !grant.authority.includes("respond"))
    )
      throw new Error("Chat access required")
    const service = options.service()
    const safe = (entry: SideQuestion) => ({
      ...entry,
      question: redactMobileText(entry.question, entry.question.length),
      answer: redactMobileText(entry.answer, entry.answer.length),
      error: entry.error ? "Could not answer. Retry or check the desktop." : null,
    })
    if (input.operation === "list") {
      const entries = service.list(input.subChatId)
      const end = Math.min(input.before ?? entries.length, entries.length)
      const start = Math.max(0, end - 5)
      return {
        entries: entries.slice(start, end).map(safe),
        before: start || null,
        ...(input.requestId
          ? { accepted: entries.some((entry) => entry.id === input.requestId) }
          : {}),
      }
    }
    if (input.operation === "ask") {
      if (!input.requestId || !input.question) throw new Error("Question required")
      return {
        entry: safe(
          service.ask({
            subChatId: input.subChatId,
            requestId: input.requestId,
            threadId: input.threadId,
            question: input.question,
          }),
        ),
      }
    }
    if (!input.id) throw new Error("Question required")
    if (input.operation === "promote") {
      const chat = options.database
        .select()
        .from(schema.chats)
        .where(eq(schema.chats.id, input.chatId))
        .get()
      if (
        !chat?.projectId ||
        !grant.capabilities.includes("chat.create") ||
        !grant.authority.includes("control") ||
        !options.projector.readResource(grant, "project", chat.projectId)
      )
        throw new Error("Project chat access required")
      return service.promote(input.subChatId, input.id)
    }
    return { entry: safe(service[input.operation](input.subChatId, input.id)) }
  }
}
