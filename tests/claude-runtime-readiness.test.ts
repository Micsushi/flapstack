import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))
vi.mock("../src/main/lib/agent-runtime/activity-service", () => ({
  broadcastAgentActivityInvalidation: vi.fn(),
}))
vi.mock("../src/main/lib/mcp-control/invalidation-bridge", () => ({
  publishLocalProductInvalidation: vi.fn(),
}))

import {
  parseClaudeAuthenticationOutput,
  probeClaudeRuntimeReadiness,
  resetMainRuntimeLaunchServicesForTests,
} from "../src/main/lib/main-run-launcher"

describe("Claude Runtime readiness", () => {
  beforeEach(() => resetMainRuntimeLaunchServicesForTests())

  it("reports a missing bundled binary without attempting authentication", async () => {
    const probeAuthentication = vi.fn(async () => ({ status: "authenticated" as const }))

    await expect(
      probeClaudeRuntimeReadiness({
        resolveBinaryPath: async () => "missing-claude",
        binaryExists: () => false,
        probeAuthentication,
      }),
    ).resolves.toMatchObject({
      available: false,
      unavailableReason: "Bundled Claude Code binary is missing.",
    })
    expect(probeAuthentication).not.toHaveBeenCalled()
  })

  it("reports authentication separately from binary availability", async () => {
    await expect(
      probeClaudeRuntimeReadiness({
        resolveBinaryPath: async () => "claude",
        binaryExists: () => true,
        probeAuthentication: async () => ({ status: "logged-out" }),
      }),
    ).resolves.toMatchObject({
      available: false,
      unavailableReason: "Claude Code authentication required. Connect Claude Code, then retry.",
    })
  })

  it("releases direct Claude only when its binary and authentication are ready", async () => {
    await expect(
      probeClaudeRuntimeReadiness({
        resolveBinaryPath: async () => "claude",
        binaryExists: () => true,
        probeAuthentication: async () => ({ status: "authenticated" }),
      }),
    ).resolves.toMatchObject({ available: true, unavailableReason: null })
  })

  it("keeps probe failures separate from a verified logout", async () => {
    await expect(
      probeClaudeRuntimeReadiness({
        resolveBinaryPath: async () => "claude",
        binaryExists: () => true,
        probeAuthentication: async () => ({
          status: "error",
          reason: "Claude Code returned an unreadable authentication status. Retry the launch.",
        }),
      }),
    ).resolves.toMatchObject({
      available: false,
      unavailableReason:
        "Claude Code returned an unreadable authentication status. Retry the launch.",
    })
  })

  it("shares one in-flight authentication probe and keeps the confirmed result briefly", async () => {
    let resolveProbe!: (value: { status: "authenticated" }) => void
    const probeAuthentication = vi.fn(
      () =>
        new Promise<{ status: "authenticated" }>((resolve) => {
          resolveProbe = resolve
        }),
    )
    const dependencies = {
      resolveBinaryPath: async () => "claude",
      binaryExists: () => true,
      probeAuthentication,
    }

    const first = probeClaudeRuntimeReadiness(dependencies)
    const second = probeClaudeRuntimeReadiness(dependencies)
    await vi.waitFor(() => expect(probeAuthentication).toHaveBeenCalledTimes(1))
    resolveProbe({ status: "authenticated" })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ available: true }),
      expect.objectContaining({ available: true }),
    ])
    await expect(probeClaudeRuntimeReadiness(dependencies)).resolves.toMatchObject({
      available: true,
    })
    expect(probeAuthentication).toHaveBeenCalledTimes(1)
  })

  it("accepts only explicit Claude auth status JSON", () => {
    expect(parseClaudeAuthenticationOutput('{"loggedIn":true}')).toEqual({
      status: "authenticated",
    })
    expect(parseClaudeAuthenticationOutput('{"loggedIn":false}')).toEqual({
      status: "logged-out",
    })
    expect(parseClaudeAuthenticationOutput("not json")).toBeNull()
    expect(parseClaudeAuthenticationOutput('{"status":"ok"}')).toBeNull()
  })
})
