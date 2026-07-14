// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  useQuery,
  useRecoveryQuery,
  useAuthorizeRetryMutation,
  useReconcileMutation,
  useUtils,
  authorizeRetry,
  reconcile,
  invalidateRecovery,
  invalidateAudit,
} = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useRecoveryQuery: vi.fn(),
  useAuthorizeRetryMutation: vi.fn(),
  useReconcileMutation: vi.fn(),
  useUtils: vi.fn(),
  authorizeRetry: vi.fn(async () => ({ authorized: true })),
  reconcile: vi.fn(async () => ({ reconciled: true })),
  invalidateRecovery: vi.fn(async () => undefined),
  invalidateAudit: vi.fn(async () => undefined),
}))

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    appControl: {
      listAuditLog: { useQuery },
      listAuditRecovery: { useQuery: useRecoveryQuery },
      authorizeAuditRetry: { useMutation: useAuthorizeRetryMutation },
      reconcileAuditClaim: { useMutation: useReconcileMutation },
    },
    useUtils,
  },
}))

import { McpAuditViewer } from "../src/renderer/features/mcp-safety/audit-viewer"

const entry = {
  id: "audit-1",
  invocationId: "call-1",
  decision: "denied" as const,
  callerChatId: "chat-1",
  callerRunId: "run-1",
  toolName: "archive_chat",
  tier: 2 as const,
  durationMs: 12,
  occurredAt: "2026-07-12T10:00:00.000Z",
  detail: {
    callerSummary: '{"chatId":"chat-1"}',
    chatSummary: '{"name":"Fix parser"}',
    runSummary: '{"id":"run-1"}',
    inputSummary: '{"target":"chat-1","token":"[REDACTED]"}',
    resultSummary: '{"reasoning":"[REDACTED]","result":"denied"}',
  },
}

describe("MCP audit viewer", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    useQuery.mockReturnValue({
      data: { entries: [entry], nextCursor: "next-page" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    useRecoveryQuery.mockReturnValue({ data: [], isLoading: false, isError: false })
    useAuthorizeRetryMutation.mockReturnValue({
      mutateAsync: authorizeRetry,
      isPending: false,
      isError: false,
    })
    useReconcileMutation.mockReturnValue({
      mutateAsync: reconcile,
      isPending: false,
      isError: false,
    })
    useUtils.mockReturnValue({
      appControl: {
        listAuditRecovery: { invalidate: invalidateRecovery },
        listAuditLog: { invalidate: invalidateAudit },
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("queries the redacted audit contract, filters, pages, and opens only an explicit chat target", async () => {
    const onOpenChat = vi.fn()
    await act(async () =>
      root.render(createElement(McpAuditViewer, { initialCallerChatId: "chat-1", onOpenChat })),
    )

    expect(useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ callerChatId: "chat-1", limit: 25 }),
    )
    expect(container.textContent).toContain("archive_chat")
    expect(container.textContent).toContain("[REDACTED]")
    expect(container.textContent).not.toContain("raw-provider-secret")

    await act(async () => (container.querySelector("summary") as HTMLElement).click())
    await act(async () =>
      (container.querySelector('[data-safe-target="chat"]') as HTMLButtonElement).click(),
    )
    expect(onOpenChat).toHaveBeenCalledWith("chat-1")

    const tool = container.querySelector(
      'input[aria-label="Filter audit history by tool"]',
    ) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(tool, "archive")
      tool.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ toolName: "archive", cursor: undefined }),
    )

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Next")
        ?.click(),
    )
    expect(useQuery).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-page" }))
  })

  it("shows empty and retryable error states", async () => {
    useQuery.mockReturnValueOnce({
      data: { entries: [], nextCursor: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    await act(async () => root.render(createElement(McpAuditViewer, {})))
    expect(container.textContent).toContain("No audit records match these filters.")

    const refetch = vi.fn()
    useQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    await act(async () => root.render(createElement(McpAuditViewer, {})))
    await act(async () =>
      (
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Retry",
        ) as HTMLButtonElement
      ).click(),
    )
    expect(refetch).toHaveBeenCalled()
  })

  it("exposes bounded retry and verified reconciliation actions", async () => {
    useRecoveryQuery.mockReturnValue({
      data: [
        {
          invocationId: "call-retry",
          callerChatId: "chat-1",
          callerRunId: "run-1",
          toolName: "list_projects",
          tier: 0,
          state: "recovery-retryable",
          retrySafe: true,
          createdAt: "2026-07-12T10:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
    })
    await act(async () => root.render(createElement(McpAuditViewer, {})))

    expect(container.textContent).toContain("Execution reconciliation")
    await act(async () =>
      (
        container.querySelector(
          '[aria-label="Authorize one retry for call-retry"]',
        ) as HTMLButtonElement
      ).click(),
    )
    expect(authorizeRetry).toHaveBeenCalledWith({ invocationId: "call-retry" })

    await act(async () =>
      (
        container.querySelector('[aria-label="Mark call-retry completed"]') as HTMLButtonElement
      ).click(),
    )
    expect(reconcile).toHaveBeenCalledWith({ invocationId: "call-retry", outcome: "completed" })
    expect(invalidateRecovery).toHaveBeenCalled()
    expect(invalidateAudit).toHaveBeenCalled()
  })
})
