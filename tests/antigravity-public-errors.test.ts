import { expect, it, vi } from "vitest"
import { createAntigravitySession } from "../src/main/lib/agent-runtime/antigravity/adapter"

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
