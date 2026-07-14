import { describe, expect, it, vi } from "vitest"
import { AgentInputLifecycleService } from "../src/main/lib/agent-input/service"
import type { AgentInputRequest } from "../src/shared/agent-input"

function request(overrides: Partial<AgentInputRequest> = {}): AgentInputRequest {
  return {
    requestId: "request-1",
    chatId: "chat-1",
    runId: "run-1",
    origin: { harness: "claude-code" },
    capability: { mode: "native", sameRun: true },
    questions: [
      {
        id: "question-1",
        question: "Continue?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
        multiSelect: false,
        allowCustom: true,
      },
    ],
    status: "pending",
    createdAt: 1,
    ...overrides,
  }
}

describe("agent input lifecycle", () => {
  it("answers exactly once and never resumes twice", async () => {
    const service = new AgentInputLifecycleService()
    const result = service.create(request())
    expect(
      service.answer({
        requestId: "request-1",
        mode: "structured",
        answers: { "question-1": ["Yes"] },
        submittedAt: 2,
      }),
    ).toBe(true)
    expect(
      service.answer({
        requestId: "request-1",
        mode: "structured",
        answers: { "question-1": ["No"] },
        submittedAt: 3,
      }),
    ).toBe(false)
    await expect(result).resolves.toMatchObject({ status: "answered" })
  })

  it("supports independent pending requests across chats and serializes within a run", () => {
    const service = new AgentInputLifecycleService()
    void service.create(request())
    void service.create(request({ requestId: "request-2", chatId: "chat-2", runId: "run-2" }))
    expect(service.list()).toHaveLength(2)
    expect(() => service.create(request({ requestId: "request-3" }))).toThrow(/already has/i)
    service.dispose()
  })

  it("cleans up on abort, timeout, chat stop, and dispose", async () => {
    vi.useFakeTimers()
    const service = new AgentInputLifecycleService()
    const controller = new AbortController()
    const aborted = service.create(request(), { signal: controller.signal })
    controller.abort()
    await expect(aborted).resolves.toMatchObject({ status: "cancelled" })

    const expired = service.create(request({ requestId: "request-2", runId: "run-2" }), {
      timeoutMs: 10,
    })
    await vi.advanceTimersByTimeAsync(10)
    await expect(expired).resolves.toMatchObject({ status: "expired" })

    void service.create(request({ requestId: "request-3", runId: "run-3" }))
    expect(service.cancelByChat("chat-1")).toBe(1)
    expect(service.list()).toHaveLength(0)
    vi.useRealTimers()
  })

  it("uses request expiry and enforces single-select/custom-answer rules", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const service = new AgentInputLifecycleService()
    const expired = service.create(request({ expiresAt: 110 }))
    await vi.advanceTimersByTimeAsync(10)
    await expect(expired).resolves.toMatchObject({ status: "expired" })

    void service.create(
      request({
        requestId: "request-2",
        runId: "run-2",
        questions: [
          {
            ...request().questions[0],
            allowCustom: false,
          },
        ],
      }),
    )
    expect(() =>
      service.answer({
        requestId: "request-2",
        mode: "structured",
        answers: { "question-1": ["Yes", "No"] },
        submittedAt: 111,
      }),
    ).toThrow(/exactly one/i)
    expect(() =>
      service.answer({
        requestId: "request-2",
        mode: "structured",
        answers: { "question-1": ["Maybe"] },
        submittedAt: 112,
      }),
    ).toThrow(/custom answer/i)
    service.dispose()
    vi.useRealTimers()
  })
})
