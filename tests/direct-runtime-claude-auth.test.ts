// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

const prepare = vi.hoisted(() => vi.fn())
const launch = vi.hoisted(() => vi.fn())
const cancel = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {},
  trpcClient: {
    agentRuntimeChat: {
      prepare: { mutate: prepare },
      launch: { subscribe: launch },
      cancel: { mutate: cancel },
    },
  },
}))
vi.mock("../src/renderer/contexts/TRPCProvider", () => ({ getQueryClient: () => null }))
vi.mock("sonner", () => ({ toast: { error: toastError } }))

import {
  createDirectRuntimeStream,
  hasClaudeRuntimeAuthenticationFailure,
  isClaudeRuntimeAuthenticationError,
} from "../src/renderer/features/agents/lib/direct-runtime-chat-transport"
import { pendingAuthRetryMessageAtom } from "../src/renderer/features/agents/atoms"
import { agentsLoginModalOpenAtom, claudeLoginModalConfigAtom } from "../src/renderer/lib/atoms"
import { appStore } from "../src/renderer/lib/jotai-store"

const input = {
  chatId: "chat",
  subChatId: "subchat",
  harness: "claude-code" as const,
  prompt: "Continue the task",
  model: "claude-opus-5-5",
  mode: "write" as const,
  reasoningEffort: "medium" as const,
  reasoningEnabled: true,
  images: [],
  hotlineEnabled: false,
}

afterEach(() => {
  prepare.mockReset()
  launch.mockReset()
  cancel.mockReset()
  toastError.mockReset()
  appStore.set(pendingAuthRetryMessageAtom, null)
  appStore.set(agentsLoginModalOpenAtom, false)
  appStore.set(claudeLoginModalConfigAtom, {})
})

describe("direct Claude Runtime authentication", () => {
  it("routes an authentication readiness failure into the existing login and retry flow", async () => {
    prepare.mockRejectedValueOnce(
      new Error("Claude Code authentication required. Connect Claude Code, then retry."),
    )

    await expect(createDirectRuntimeStream(input)).rejects.toThrow(
      "Claude Code authentication required",
    )
    expect(appStore.get(pendingAuthRetryMessageAtom)).toEqual({
      subChatId: "subchat",
      provider: "claude-code",
      prompt: "Continue the task",
      readyToRetry: false,
    })
    expect(toastError).toHaveBeenCalledWith(
      "Claude Code authentication required",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Connect" }),
      }),
    )

    const toastOptions = toastError.mock.calls[0]?.[1] as { action: { onClick(): void } }
    toastOptions.action.onClick()
    expect(appStore.get(agentsLoginModalOpenAtom)).toBe(true)
    expect(appStore.get(claudeLoginModalConfigAtom)).toEqual({
      hideCustomModelSettingsLink: true,
      autoStartAuth: true,
    })
  })

  it("does not recast unrelated Runtime failures as authentication failures", async () => {
    prepare.mockRejectedValueOnce(new Error("Worktree is missing"))

    await expect(createDirectRuntimeStream(input)).rejects.toThrow("Worktree is missing")
    expect(appStore.get(pendingAuthRetryMessageAtom)).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("recognizes provider auth activity without matching unrelated errors", () => {
    for (const payload of [
      { code: "auth-error", message: "Session expired" },
      { code: "authentication_failed", message: "Authentication failed" },
      { code: "claude-result-error", message: "OAuth token has expired" },
      { code: "claude-result-error", message: "API Error: 401" },
      { code: "claude-result-error", message: "Please run `/login`" },
    ]) {
      expect(
        hasClaudeRuntimeAuthenticationFailure([{ kind: "warning", phase: "failed", payload }]),
      ).toBe(true)
    }
    expect(
      hasClaudeRuntimeAuthenticationFailure([
        {
          kind: "subagent",
          phase: "completed",
          payload: {
            state: "message:reviewer",
            message: "The login page displays authentication required.",
          },
        },
      ]),
    ).toBe(false)
    expect(isClaudeRuntimeAuthenticationError(new Error("Claude is not logged in"))).toBe(true)
    expect(isClaudeRuntimeAuthenticationError(new Error("Network connection failed"))).toBe(false)
  })

  it("cancels a mid-run Claude authentication failure before exposing retry", async () => {
    prepare.mockResolvedValueOnce({ direct: true })
    let observer: { onData(event: unknown): void } | undefined
    const unsubscribe = vi.fn()
    launch.mockImplementationOnce((_input, nextObserver) => {
      observer = nextObserver
      return { unsubscribe }
    })
    let finishCancellation: (() => void) | undefined
    cancel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishCancellation = resolve
      }),
    )

    const stream = await createDirectRuntimeStream(input)
    const read = stream!.getReader().read()
    observer!.onData({
      type: "activity-batch",
      events: [
        {
          kind: "warning",
          phase: "failed",
          payload: { code: "authentication_failed", message: "Please run /login" },
        },
      ],
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(appStore.get(pendingAuthRetryMessageAtom)).toBeNull()

    finishCancellation!()
    await expect(read).rejects.toThrow("Claude Code authentication required")
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0])
    expect(appStore.get(pendingAuthRetryMessageAtom)).toMatchObject({
      subChatId: "subchat",
      provider: "claude-code",
      prompt: "Continue the task",
      readyToRetry: false,
    })
  })
})
