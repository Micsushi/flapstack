import { expect, it, vi } from "vitest"
import {
  readPendingFeedback,
  storePendingFeedback,
  clearPendingFeedback,
} from "../src/renderer/lib/diff-feedback-request"
const request = {
  id: "aaaabbbb-1111-4111-8111-123456789012",
  chatId: "chat",
  projectId: "project",
  subChatId: "sub",
  comments: [{ id: "aaaabbbb-1111-4111-8111-123456789013", version: 1 }],
}
function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}
it("retains exact retry identity across readers and refuses a conflicting target", () => {
  const store = storage()
  storePendingFeedback(store, request)
  expect(readPendingFeedback(store, request)).toEqual(request)
  expect(() => storePendingFeedback(store, { ...request, subChatId: "other" })).toThrow("pending")
  expect(readPendingFeedback(store, { ...request, chatId: "other" })).toBeNull()
  clearPendingFeedback(store, { ...request, id: "aaaabbbb-1111-4111-8111-123456789014" })
  expect(readPendingFeedback(store, request)).toEqual(request)
  clearPendingFeedback(store, request)
  expect(readPendingFeedback(store, request)).toBeNull()
})
it("fails closed on refused writes and strips non-contract content", () => {
  const store = storage()
  storePendingFeedback(store, { ...request, body: "Not stored" } as typeof request)
  expect(JSON.stringify(readPendingFeedback(store, request))).not.toContain("Not stored")
  expect(() =>
    storePendingFeedback(
      {
        ...store,
        setItem: vi.fn(() => {
          throw new Error("quota")
        }),
      },
      request,
    ),
  ).toThrow("quota")
  expect(() => storePendingFeedback({ ...storage(), setItem: () => {} }, request)).toThrow(
    "Nothing was sent",
  )
})
