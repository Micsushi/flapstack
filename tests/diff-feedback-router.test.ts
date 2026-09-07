import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  enabled: false,
  queue: vi.fn(),
  resolve: vi.fn(),
  cancel: vi.fn(),
  inputCancel: vi.fn(),
  publish: vi.fn(),
}))
vi.mock("../src/main/lib/beta-features/settings", () => ({
  isBetaFeatureEnabled: () => state.enabled,
  betaFeatureForTrpcPath: () => "diffAnnotations",
}))
vi.mock("../src/main/lib/db/access", () => ({
  acquireConfiguredAppDatabaseOperation: () => () => undefined,
}))
vi.mock("../src/main/lib/db", () => ({
  getDatabase: () => ({}),
  getSqliteDatabase: () => ({}),
  getDatabasePath: () => "fixture",
}))
vi.mock("../src/main/lib/diff-annotations/service", () => ({ DiffAnnotationService: class {} }))
vi.mock("../src/main/lib/diff-annotations/feedback", () => ({
  DiffFeedbackService: class {
    queue(input: unknown) {
      return state.queue(input)
    }
    getBatchRun(input: unknown) {
      return state.resolve(input)
    }
  },
}))
vi.mock("../src/main/lib/agent-runtime/launch-access", () => ({
  requireRuntimeLaunchAuthority: () => ({ cancel: state.cancel }),
}))
vi.mock("../src/main/lib/agent-input/service", () => ({
  agentInputLifecycle: { cancelByRun: state.inputCancel },
}))
vi.mock("../src/main/lib/mcp-control/invalidation-bridge", () => ({
  publishLocalProductInvalidation: state.publish,
}))
import { diffAnnotationsRouter } from "../src/main/lib/trpc/routers/diff-annotations"
const input = {
  id: "aaaabbbb-1111-4111-8111-123456789012",
  chatId: "chat",
  projectId: "project",
  subChatId: "sub",
  comments: [{ id: "aaaabbbb-1111-4111-8111-123456789013", version: 1 }],
}
const caller = diffAnnotationsRouter.createCaller({ getWindow: () => null })
beforeEach(() => {
  vi.resetAllMocks()
  state.enabled = false
})
it("blocks sending and cancellation before invoking any authority while beta is disabled", async () => {
  await expect(caller.send(input)).rejects.toThrow("Enable")
  await expect(caller.cancelFeedback(input)).rejects.toThrow("Enable")
  expect(state.queue).not.toHaveBeenCalled()
  expect(state.resolve).not.toHaveBeenCalled()
})
it("publishes committed feedback and cancels only the scoped resolved run", async () => {
  state.enabled = true
  state.queue.mockResolvedValue({ id: input.id, runId: "owned", chatId: "chat" })
  expect(await caller.send(input)).toMatchObject({ runId: "owned" })
  expect(state.publish).toHaveBeenCalledWith(
    expect.objectContaining({ chatIds: ["chat"], runIds: ["owned"] }),
  )
  state.resolve.mockReturnValue({ runId: "owned", chatId: "chat" })
  state.cancel.mockResolvedValue(true)
  expect(await caller.cancelFeedback(input)).toEqual({ cancelled: true })
  expect(state.cancel).toHaveBeenCalledWith("owned", "user-cancelled")
})
it("rejects an unresolved scope before cancellation or input mutation", async () => {
  state.enabled = true
  state.resolve.mockImplementation(() => {
    throw new Error("scope")
  })
  await expect(caller.cancelFeedback(input)).rejects.toThrow("scope")
  expect(state.inputCancel).not.toHaveBeenCalled()
  expect(state.cancel).not.toHaveBeenCalled()
})
