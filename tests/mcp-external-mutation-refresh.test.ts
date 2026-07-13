import { createConnection } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  invalidationForProductMcpMutation,
  parseProductMcpRendererInvalidation,
  PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV,
  type ProductMcpRendererInvalidation,
} from "../src/shared/product-mcp-invalidation"
import {
  publishProductMcpInvalidation,
  startProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import { buildMcpStdioRegistration } from "../src/main/lib/mcp-control/registration"
import {
  createProductMcpInvalidationCoalescer,
  createProductMcpRendererInvalidator,
} from "../src/renderer/features/mcp-safety/external-mutation-refresh-model"

afterEach(() => {
  vi.useRealTimers()
  delete process.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]
})

describe("product MCP external mutation refresh", () => {
  it("publishes only successful changed product mutations after their response", () => {
    expect(
      invalidationForProductMcpMutation(
        "archive_item",
        { kind: "chat", id: "chat-2" },
        { ok: true, data: { id: "chat-2", changed: true } },
      ),
    ).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["chats"],
      chatIds: ["chat-2"],
    })
    expect(
      invalidationForProductMcpMutation(
        "launch_run",
        { chatId: "chat-2" },
        { ok: true, data: { runId: "run-2", created: true } },
      ),
    ).toMatchObject({ domains: ["runs", "chats"], chatIds: ["chat-2"], runIds: ["run-2"] })
    expect(
      invalidationForProductMcpMutation(
        "archive_item",
        { kind: "chat", id: "chat-2" },
        { ok: true, data: { changed: false } },
      ),
    ).toBeNull()
    expect(
      invalidationForProductMcpMutation(
        "archive_item",
        { kind: "chat", id: "chat-2" },
        {
          ok: false,
          error: { code: "internal-error", message: "rolled back" },
        },
      ),
    ).toBeNull()
  })

  it("bridges validated product events over a product-only local endpoint", async () => {
    const received: ProductMcpRendererInvalidation[] = []
    const bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    try {
      const sent = await publishProductMcpInvalidation(
        { version: 1, source: "product-mcp", domains: ["audit"], chatIds: ["chat-1"] },
        bridge.endpoint,
      )
      expect(sent).toBe(true)
      await vi.waitFor(() => expect(received).toHaveLength(1))

      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(bridge.endpoint)
        socket.once("connect", () =>
          socket.end(
            `${JSON.stringify({
              version: 1,
              source: "product-mcp",
              domains: ["chats"],
              token: "must-not-cross",
            })}\n`,
            resolve,
          ),
        )
        socket.once("error", reject)
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(received).toHaveLength(1)
    } finally {
      await bridge.stop()
    }
  })

  it("coalesces bursts and invalidates only affected tRPC query families", async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const invalidate = createProductMcpRendererInvalidator({
      projectsList: () => calls.push("projects.list"),
      projectsArchived: () => calls.push("projects.archived"),
      tasksList: () => calls.push("tasks.list"),
      tasksArchived: () => calls.push("tasks.archived"),
      chatsList: () => calls.push("chats.list"),
      chatsArchived: () => calls.push("chats.archived"),
      chat: (id) => calls.push(`chat:${id}`),
      runsForChat: (id) => calls.push(`chat-runs:${id}`),
      run: (id) => calls.push(`run:${id}`),
      attachmentsForChat: (id) => calls.push(`attachments:${id}`),
      approvals: () => calls.push("approvals"),
      audit: () => calls.push("audit"),
    })
    const coalescer = createProductMcpInvalidationCoalescer(invalidate, 25)
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["chats", "runs"],
      chatIds: ["chat-1"],
      runIds: ["run-1"],
    })
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["audit", "approvals"],
      chatIds: ["chat-1"],
    })

    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(25)
    expect(calls).toEqual([
      "chats.list",
      "chats.archived",
      "chat:chat-1",
      "chat-runs:chat-1",
      "run:run-1",
      "approvals",
      "audit",
    ])
    coalescer.dispose()
  })
})

describe("product and development MCP boundary", () => {
  it("does not accept descriptor, endpoint, or bearer-token fields on renderer events", () => {
    for (const extra of [
      { descriptor: { url: "http://127.0.0.1:1", token: "secret" } },
      { token: "secret" },
      { url: "http://127.0.0.1:1" },
    ]) {
      expect(
        parseProductMcpRendererInvalidation({
          version: 1,
          source: "product-mcp",
          domains: ["audit"],
          ...extra,
        }),
      ).toBeNull()
    }
  })

  it("registers only the product invalidation endpoint with product stdio", () => {
    process.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV] = "/tmp/product-only.sock"
    const registration = buildMcpStdioRegistration(
      { chatId: "chat-1", permissionMode: "full-access" },
      { executablePath: "/electron", mainDirectory: "/out/main", databasePath: "/data/db" },
    )

    expect(registration.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]).toBe("/tmp/product-only.sock")
    expect(Object.keys(registration.env).some((key) => /DEV_MCP|TOKEN|DESCRIPTOR/i.test(key))).toBe(
      false,
    )
    expect(Object.values(registration.env).some((value) => /^https?:\/\//.test(value))).toBe(false)
  })
})
