import { expect, it, vi } from "vitest"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"
import { AgentInputLifecycleService } from "../src/main/lib/agent-input/service"
import { answerAntigravityForm } from "../src/main/lib/agent-runtime/antigravity/questions"

const controller = new AbortController()
const context = {
  subChatId: "chat",
  runId: "run",
  signal: controller.signal,
  launch: { model: "gemini-4-neon-medium" },
} as RuntimeAdapterContext
const params = {
  mode: "form",
  message: "Pick a report.",
  requestedSchema: {
    type: "object",
    required: ["kind", "ship"],
    properties: {
      kind: {
        type: "string",
        oneOf: [
          { title: "Summary", const: "summary-id" },
          { title: "Detail", const: "detail-id" },
        ],
      },
      ship: { type: "boolean" },
      sections: { type: "array", items: { enum: ["Overview", "Analysis"] } },
      extra: { type: "string" },
    },
  },
}
it("resolves the original Gemini turn with wire values and preserves an omitted optional field", async () => {
  const lifecycle = new AgentInputLifecycleService()
  const result = answerAntigravityForm(context, params, (request, signal) =>
    lifecycle.create(request, { signal }),
  )
  const [request] = lifecycle.list("chat")
  expect(request).toMatchObject({
    runId: "run",
    origin: { provider: "antigravity" },
    capability: { sameRun: true, mode: "native" },
  })
  lifecycle.answer({
    requestId: request!.requestId,
    mode: "structured",
    submittedAt: Date.now(),
    answers: {
      "field-1": ["Detail"],
      "field-2": ["No"],
      "field-3": ["Overview", "Analysis"],
      "field-4": ["Leave blank"],
    },
  })
  await expect(result).resolves.toEqual({
    action: "accept",
    content: { kind: "detail-id", ship: false, sections: ["Overview", "Analysis"] },
  })
})
it("declines skipped questions and cancels unsupported forms without opening an input", async () => {
  const skipped = vi.fn(async () => ({ status: "skipped" as const, message: "Skipped" }))
  await expect(answerAntigravityForm(context, params, skipped)).resolves.toEqual({
    action: "decline",
  })
  const ask = vi.fn()
  for (const unsupported of [
    { ...params, mode: "url" },
    {
      ...params,
      requestedSchema: {
        type: "object",
        properties: { password: { type: "string", format: "password" } },
      },
    },
    { ...params, requestedSchema: { type: "object", properties: { nested: { type: "object" } } } },
  ])
    await expect(answerAntigravityForm(context, unsupported, ask)).resolves.toEqual({
      action: "cancel",
    })
  expect(ask).not.toHaveBeenCalled()
})
