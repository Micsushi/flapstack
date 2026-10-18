import { describe, expect, it, vi } from "vitest"
import {
  createMobileSideQuestionDispatch,
  mobileSideQuestionSchema,
} from "../src/main/lib/mobile-bridge/side-questions"
import { chats } from "../src/main/lib/db/schema"

function fixture() {
  const grant = { capabilities: ["chat.send", "chat.create"], authority: ["respond", "control"] }
  const requireActiveGrant = vi.fn(() => grant)
  const readResource = vi.fn((_grant: unknown, _kind: string, id: string) =>
    id === "chat" || id === "project" ? {} : null,
  )
  const source = { chatId: "chat" }
  const database = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({ get: () => (table === chats ? { projectId: "project" } : source) }),
      }),
    }),
  }
  const entry = {
    id: "question",
    subChatId: "sub",
    threadId: "thread",
    question: "Progress?",
    answer: "Working",
    error: null,
    status: "completed",
  }
  const service = {
    list: vi.fn(() => [entry]),
    ask: vi.fn(() => entry),
    retry: vi.fn(() => entry),
    cancel: vi.fn(() => entry),
    promote: vi.fn(() => ({ chatId: "new-chat", subChatId: "new-sub" })),
  }
  const dispatch = createMobileSideQuestionDispatch({
    database,
    grants: { requireActiveGrant },
    projector: { readResource },
    service: () => service,
  } as never)
  const session = { deviceId: "device", scopeVersion: 3 } as never
  const request = { grantId: "grant", chatId: "chat", subChatId: "sub", operation: "list" as const }
  return { grant, requireActiveGrant, readResource, source, service, dispatch, session, request }
}

describe("mobile side-question scope", () => {
  it("rechecks grant and exact chat ownership before every operation", () => {
    const f = fixture()
    expect(f.dispatch(f.session, f.request)).toMatchObject({ entries: [{ answer: "Working" }] })
    expect(f.requireActiveGrant).toHaveBeenCalledWith("grant", "device", 3)
    f.source.chatId = "other-chat"
    expect(() => f.dispatch(f.session, f.request)).toThrow("Conversation unavailable")
    expect(f.service.list).toHaveBeenCalledTimes(1)
    f.source.chatId = "chat"
    f.requireActiveGrant.mockImplementation(() => {
      throw new Error("revoked")
    })
    expect(() => f.dispatch(f.session, f.request)).toThrow("revoked")
    expect(f.service.list).toHaveBeenCalledTimes(1)
  })
  it("requires send rights for side mutations and project creation rights for promotion", () => {
    const f = fixture()
    f.grant.capabilities = []
    expect(() =>
      f.dispatch(f.session, {
        ...f.request,
        operation: "ask",
        question: "Progress?",
        requestId: "id",
      }),
    ).toThrow("Chat access required")
    f.grant.capabilities = ["chat.send"]
    expect(() => f.dispatch(f.session, { ...f.request, operation: "promote", id: "id" })).toThrow(
      "Project chat access required",
    )
    f.grant.capabilities.push("chat.create")
    f.readResource.mockImplementation((_grant, kind) => (kind === "project" ? null : {}))
    expect(() => f.dispatch(f.session, { ...f.request, operation: "promote", id: "id" })).toThrow(
      "Project chat access required",
    )
    expect(f.service.promote).not.toHaveBeenCalled()
    f.readResource.mockReturnValue({})
    expect(f.dispatch(f.session, { ...f.request, operation: "promote", id: "id" })).toEqual({
      chatId: "new-chat",
      subChatId: "new-sub",
    })
  })
  it("accepts no provider override or supplied conversation and keeps side operations separate", () => {
    const f = fixture()
    expect(mobileSideQuestionSchema.safeParse({ ...f.request, visibleMessages: [] }).success).toBe(
      false,
    )
    expect(mobileSideQuestionSchema.safeParse({ ...f.request, provider: "codex" }).success).toBe(
      false,
    )
    f.dispatch(f.session, {
      ...f.request,
      operation: "ask",
      question: "Progress?",
      requestId: "id",
    })
    expect(f.service.ask).toHaveBeenCalledWith({
      subChatId: "sub",
      question: "Progress?",
      requestId: "id",
      threadId: undefined,
    })
    f.dispatch(f.session, { ...f.request, operation: "cancel", id: "id" })
    f.dispatch(f.session, { ...f.request, operation: "retry", id: "id" })
    expect(f.service.cancel).toHaveBeenCalledWith("sub", "id")
    expect(f.service.retry).toHaveBeenCalledWith("sub", "id")
  })
})
