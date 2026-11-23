import { expect, it } from "vitest"
import { antigravityError } from "../src/main/lib/agent-runtime/antigravity/adapter"

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
