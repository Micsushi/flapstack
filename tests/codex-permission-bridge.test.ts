import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  allowCodexPermissionRequest,
  createCodexPermissionDecision,
  findAllowOption,
  findRejectOption,
  rejectCodexPermissionRequest,
  resolveCodexPermissionOption,
  summarizeCodexPermissionRequest,
  listPendingCodexPermissionRequests,
  registerPendingCodexPermissionRequest,
  replyPendingCodexPermissionRequest,
} from "../src/main/lib/codex/permission-bridge"

afterEach(() => {
  vi.useRealTimers()
})

const options = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" as const },
  { optionId: "allow-always", name: "Always allow", kind: "allow_always" as const },
  { optionId: "reject-once", name: "Reject", kind: "reject_once" as const },
]

describe("Codex ACP permission bridge", () => {
  it("prefers a one-time rejection for fail-closed outcomes", () => {
    expect(findRejectOption(options)?.optionId).toBe("reject-once")
    expect(rejectCodexPermissionRequest({ options })).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })

  it("cancels when the provider does not offer a rejection", () => {
    expect(rejectCodexPermissionRequest({ options: options.slice(0, 2) })).toEqual({
      outcome: { outcome: "cancelled" },
    })
  })

  it("accepts only an exact provider option and rejects unknown ids", () => {
    expect(resolveCodexPermissionOption({ options }, "allow-once")).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    })
    expect(resolveCodexPermissionOption({ options }, "invented-allow")).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })

  it("summarizes pending requests without exposing raw input or metadata", () => {
    const summary = summarizeCodexPermissionRequest({
      requestId: "request-1",
      subChatId: "sub-chat-1",
      runId: "run-1",
      request: {
        toolCall: {
          toolCallId: "tool-1",
          title: "Write release marker",
          kind: "edit",
          rawInput: { secret: "must-not-return" },
        },
        options,
        _meta: { private: "must-not-return" },
      },
    })

    expect(summary).toMatchObject({ requestId: "request-1", title: "Write release marker" })
    expect(JSON.stringify(summary)).not.toContain("must-not-return")
  })

  it("lists and resolves only the exact registered pending request", () => {
    const resolve = vi.fn()
    registerPendingCodexPermissionRequest("request-live", {
      subChatId: "sub-chat-live",
      runId: "run-live",
      request: {
        toolCall: { toolCallId: "tool-live", title: "Write marker", kind: "edit" },
        options,
      },
      resolve,
    })

    expect(listPendingCodexPermissionRequests({ runId: "run-live" })).toEqual([
      expect.objectContaining({ requestId: "request-live", runId: "run-live" }),
    ])
    expect(
      replyPendingCodexPermissionRequest({ requestId: "request-live", optionId: "unknown" }),
    ).toEqual({ resolved: true })
    expect(resolve).toHaveBeenCalledWith({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
    expect(listPendingCodexPermissionRequests({ runId: "run-live" })).toEqual([])
  })

  it("prefers a one-time allow response for full access", () => {
    expect(findAllowOption(options)?.optionId).toBe("allow-once")
    expect(allowCodexPermissionRequest({ options })).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    })
    expect(allowCodexPermissionRequest({ options: options.slice(2) })).toEqual({
      outcome: { outcome: "cancelled" },
    })
  })

  it("rejects pending approval on timeout", async () => {
    vi.useFakeTimers()
    const decision = createCodexPermissionDecision({
      request: { options },
      signal: new AbortController().signal,
      timeoutMs: 25,
    })

    await vi.advanceTimersByTimeAsync(25)
    await expect(decision.promise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })

  it("rejects pending approval when its run aborts", async () => {
    const controller = new AbortController()
    const decision = createCodexPermissionDecision({
      request: { options },
      signal: controller.signal,
      timeoutMs: 60_000,
    })

    controller.abort()
    await expect(decision.promise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })

  it("wires router approvals to run aborts and pending-map cleanup", () => {
    const source = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    expect(source).toContain("signal: abortController.signal")
    expect(source).toContain(
      "return decision.promise.finally(() => removePendingCodexPermissionRequest(requestId))",
    )
  })

  it("keeps installed ACP provider bundles fail closed and callback-aware", () => {
    const require = createRequire(import.meta.url)
    const packageRoot = dirname(require.resolve("@mcpc-tech/acp-ai-provider"))

    for (const filename of ["index.cjs", "index.mjs"]) {
      const source = readFileSync(join(packageRoot, filename), "utf8")
      expect(source).not.toContain("params.options[0]?.optionId")
      expect(source).toContain(
        "this.client.setPermissionRequestHandler(this.config.permissionRequestHandler)",
      )
      expect(source).toContain("[acp-ai-provider] Stale ACP session; starting fresh.")
      expect(source).toContain(
        "const safeToolResultBlocks = Array.isArray(toolResult) ? toolResult : [];",
      )
      expect(source).toContain("if (!this.sessionId)")
      expect(source).toContain('outcome: "cancelled"')
    }

    const codexAcpSource = readFileSync(require.resolve("@agentclientprotocol/codex-acp"), "utf8")
    expect(codexAcpSource).toContain("rawInput: { serverName: params.serverName }")
    expect(codexAcpSource).toContain("excludeTmpdirEnvVar: true,\n      excludeSlashTmp: true")
  })
})
