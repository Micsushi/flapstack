import { EventEmitter, once } from "node:events"
import { PassThrough } from "node:stream"
import { beforeEach, expect, it, vi } from "vitest"

const { spawn, openExternal, integration } = vi.hoisted(() => ({
  spawn: vi.fn(),
  openExternal: vi.fn(async (_url: string) => true),
  integration: vi.fn(async () => ({ state: "connected" })),
}))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
}))
vi.mock("../src/main/lib/open-external", () => ({ openExternalSafe: openExternal }))
vi.mock("../src/main/lib/agent-runtime/antigravity/adapter", () => ({
  resolveAntigravityBinary: () => "fixture-agy",
  antigravityIntegration: integration,
  antigravityModels: vi.fn(),
}))

import {
  beginAntigravityLogin,
  antigravityLoginStatus,
  submitAntigravityCode,
  cancelAntigravityLogin,
} from "../src/main/lib/agent-runtime/antigravity/login"

import { agentRuntimeChatRouter } from "../src/main/lib/trpc/routers/agent-runtime-chat"

function fixtureProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => child.emit("close", null)),
  })
  spawn.mockReturnValueOnce(child)
  return child
}

beforeEach(() => vi.clearAllMocks())

it("opens only the Google sign-in URL and waits for provider status after an explicit code", async () => {
  const child = fixtureProcess()
  expect(beginAntigravityLogin("owned-login")).toEqual({ state: "starting", canOpenBrowser: false })
  expect(spawn).toHaveBeenCalledWith("fixture-agy", ["--login"], expect.anything())
  child.stdout.write("https://example.invalid/o/oauth2/v2/auth\n")
  expect(openExternal).not.toHaveBeenCalled()
  child.stderr.write("https://accounts.google.com/o/oauth2/v2/auth?state=fixture\n")
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(
    "https://accounts.google.com/o/oauth2/v2/auth?state=fixture",
  )
  expect(antigravityLoginStatus("owned-login")).toEqual({ state: "waiting", canOpenBrowser: true })
  expect(() => submitAntigravityCode("different-flow", "fixture")).toThrow()
  const input = once(child.stdin, "data")
  submitAntigravityCode("owned-login", "fixture-code")
  expect(String((await input)[0])).toBe("fixture-code\n")
  expect(antigravityLoginStatus("owned-login").state).toBe("verifying")
  child.emit("close", 0)
  await vi.waitFor(() => expect(antigravityLoginStatus("owned-login").state).toBe("connected"))
  cancelAntigravityLogin("owned-login")
})

it("passes a Google-style code through the router and rejects multi-line input", async () => {
  const child = fixtureProcess()
  const caller = agentRuntimeChatRouter.createCaller({ getWindow: () => null })
  const loginId = "c7703ee6-9feb-45fe-af82-9be0515d6a8b"
  await caller.startAntigravitySignIn({ loginId })
  try {
    child.stdout.write("https://accounts.google.com/o/oauth2/v2/auth?state=fixture\n")
    for (const code of ["4/0A fixture", "4/0A\nfixture", "4/0A\u0000fixture"]) {
      await expect(caller.submitAntigravitySignInCode({ loginId, code })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
    }
    expect(antigravityLoginStatus(loginId).state).toBe("waiting")

    const stdin = once(child.stdin, "data")
    const code = "4/0A_Test-99.uF"
    await expect(caller.submitAntigravitySignInCode({ loginId, code })).resolves.toMatchObject({
      state: "verifying",
    })
    expect(String((await stdin)[0])).toBe(code + "\n")
  } finally {
    cancelAntigravityLogin(loginId)
  }
})
