import { expect, it, vi } from "vitest"
import {
  antigravityError,
  createAntigravitySession,
} from "../src/main/lib/agent-runtime/antigravity/adapter"

it("keeps the native status code and public message for an ACP rejection", () => {
  const err = antigravityError("session setup", {
    code: -32603,
    message: "Unable to start the conversation",
    data: { private: "NEVER DISPLAY" },
  })
  expect(err.message).toBe(
    "Antigravity failed during session setup (ACP -32603). Unable to start the conversation",
  )
  expect(antigravityError("model selection", { error: { code: -32000 } }).message).toContain(
    "Authentication required.",
  )
})
it("sanitizes diagnostics and keeps unknown data out of the user-facing error", () => {
  const err = antigravityError("the turn", { message: "Rejected Bearer secret-fixture-token" })
  expect(err.message).not.toContain("secret-fixture-token")
  expect(antigravityError("resume", { data: { secret: "invisible" } }).message).toBe(
    "Antigravity failed during resume. The provider supplied no readable error message.",
  )
})

it("retries an explicitly rejected empty session once before any prompt can be sent", async () => {
  const rejection = { code: -32603, message: "Failed to start Antigravity conversation" }
  const create = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValue({ sessionId: "second" })
  await expect(createAntigravitySession(create, new AbortController().signal)).resolves.toEqual({
    sessionId: "second",
  })
  expect(create).toHaveBeenCalledTimes(2)
  create.mockReset().mockRejectedValue(rejection)
  await expect(createAntigravitySession(create, new AbortController().signal)).rejects.toBe(
    rejection,
  )
  expect(create).toHaveBeenCalledTimes(2)
})

it("preserves cancellation, admission refusals and ambiguous connection failures", async () => {
  const cancelled = vi.fn()
  await expect(createAntigravitySession(cancelled, AbortSignal.abort())).rejects.toMatchObject({
    name: "AbortError",
  })
  expect(cancelled).not.toHaveBeenCalled()
  for (const [error, signal] of [
    [
      {
        code: -32603,
        message: "Failed to start Antigravity conversation",
        data: { reason: "billing" },
      },
      new AbortController().signal,
    ],
    [{ code: -32000, message: "Authentication required" }, new AbortController().signal],
    [new Error("Connection closed"), new AbortController().signal],
  ] as const) {
    const create = vi.fn().mockRejectedValue(error)
    await expect(createAntigravitySession(create, signal)).rejects.toBe(error)
    expect(create).toHaveBeenCalledTimes(1)
  }
})
