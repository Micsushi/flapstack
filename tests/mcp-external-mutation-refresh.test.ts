import { createConnection } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  invalidationForProductMcpMutation,
  parseProductMcpRendererInvalidation,
  PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV,
  type ProductMcpRendererInvalidation,
} from "../src/shared/product-mcp-invalidation"
import {
  publishLocalProductInvalidation,
  publishProductMcpInvalidation,
  startProductMcpInvalidationBridge,
} from "../src/main/lib/mcp-control/invalidation-bridge"
import { buildMcpStdioRegistration } from "../src/main/lib/mcp-control/registration"
import {
  HookLifecycleService,
  MemoryHookStateStore,
  type HookApprovalDecision,
} from "../src/main/lib/extension-management"
import { publishHookExtensionChange } from "../src/main/lib/trpc/routers/hooks-management"
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
        "update_automation",
        { automationId: "automation-1", expectedVersion: 1 },
        {
          ok: true,
          data: { changed: true, record: { id: "automation-1", version: 2 } },
        },
      ),
    ).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["automations"],
      automationIds: ["automation-1"],
    })
    expect(
      invalidationForProductMcpMutation(
        "propose_task",
        { proposal: { projectId: "project-1" } },
        {
          ok: true,
          data: { created: true, record: { id: "proposal-1", projectId: "project-1" } },
        },
      ),
    ).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["task-proposals", "plan-sources"],
      projectIds: ["project-1"],
      proposalIds: ["proposal-1"],
    })
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
        "update_vault_handoff",
        { projectId: "project-1", sectionId: "handoff", expectedVersion: 2 },
        { ok: true, data: { projectId: "project-1", sectionId: "handoff", changed: true } },
      ),
    ).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["vaults"],
      projectIds: ["project-1"],
    })
    expect(
      invalidationForProductMcpMutation(
        "orchestrate_task",
        {},
        {
          ok: true,
          data: {
            orchestration: { taskId: "task-1", initiatingChatId: "chat-1" },
            agents: [
              { chatId: "chat-2", runId: "run-2" },
              { chatId: null, runId: null },
            ],
          },
        },
      ),
    ).toEqual({
      version: 1,
      source: "product-mcp",
      domains: ["tasks", "chats", "runs", "orchestrations"],
      taskIds: ["task-1"],
      chatIds: ["chat-1", "chat-2"],
      runIds: ["run-2"],
    })
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

      publishLocalProductInvalidation({
        version: 1,
        source: "product-mcp",
        domains: ["tasks", "plan-sources"],
        taskIds: ["task-1"],
        projectIds: ["project-1"],
      })
      await vi.waitFor(() => expect(received).toHaveLength(2))

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
      expect(received).toHaveLength(2)
    } finally {
      await bridge.stop()
    }
  })

  it("bridges persisted hook lifecycle changes but not an unchanged denied enable", async () => {
    const received: ProductMcpRendererInvalidation[] = []
    const bridge = await startProductMcpInvalidationBridge({
      onInvalidation: (event) => received.push(event),
    })
    try {
      const approval = vi
        .fn<() => Promise<HookApprovalDecision>>()
        .mockResolvedValueOnce("approved")
        .mockResolvedValueOnce("denied")
      const service = new HookLifecycleService(
        new MemoryHookStateStore(),
        {
          run: async () => ({
            success: true,
            exitCode: 0,
            signal: null,
            timedOut: false,
            outputLimitExceeded: false,
            durationMs: 1,
            stdout: { byteLength: 0, sha256: "a".repeat(64), truncated: false },
            stderr: { byteLength: 0, sha256: "b".repeat(64), truncated: false },
            error: null,
          }),
        },
        { request: approval },
        undefined,
        undefined,
        publishHookExtensionChange,
      )
      const imported = await service.import({
        name: "refresh windows",
        harness: "codex",
        scope: "user",
        event: "Stop",
        command: "node hook.mjs",
        timeoutMs: 500,
      })
      await service.validate(imported.id)
      await service.dryRun(imported.id)
      await vi.waitFor(() => expect(received).toHaveLength(4))

      const beforeDeniedEnable = received.length
      expect(await service.setEnabled(imported.id, true)).toMatchObject({ approval: "denied" })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(received).toHaveLength(beforeDeniedEnable)
      expect(received.every((event) => event.domains.includes("provider-extensions"))).toBe(true)
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
      task: (id) => calls.push(`task:${id}`),
      chatsList: () => calls.push("chats.list"),
      chatsArchived: () => calls.push("chats.archived"),
      chat: (id) => calls.push(`chat:${id}`),
      runsForChat: (id) => calls.push(`chat-runs:${id}`),
      run: (id) => calls.push(`run:${id}`),
      attachmentsForChat: (id) => calls.push(`attachments:${id}`),
      approvals: () => calls.push("approvals"),
      audit: () => calls.push("audit"),
      orchestrationTask: (id) => calls.push(`orchestration:${id}`),
      chatLineage: (id) => calls.push(`lineage:${id}`),
      projectVault: (id) => calls.push(`vault:${id}`),
      automations: () => calls.push("automations"),
      taskProposals: () => calls.push("task-proposals"),
      planSources: (id) => calls.push(`plan-sources:${id ?? "all"}`),
      providerExtensions: () => calls.push("provider-extensions"),
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
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["orchestrations"],
      chatIds: ["chat-1"],
      taskIds: ["task-1"],
    })
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["vaults"],
      projectIds: ["project-1"],
    })
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["automations"],
      automationIds: ["automation-1"],
    })
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["task-proposals", "plan-sources"],
      projectIds: ["project-1"],
      proposalIds: ["proposal-1"],
    })
    coalescer.push({
      version: 1,
      source: "product-mcp",
      domains: ["provider-extensions"],
      projectIds: ["project-1"],
      taskIds: ["task-1"],
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
      "orchestration:task-1",
      "lineage:chat-1",
      "vault:project-1",
      "automations",
      "task-proposals",
      "plan-sources:project-1",
      "provider-extensions",
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
      { chatId: "chat-1", runId: "run-1", permissionMode: "full-access" },
      { executablePath: "/electron", mainDirectory: "/out/main", databasePath: "/data/db" },
    )

    expect(registration.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]).toBe("/tmp/product-only.sock")
    expect(Object.keys(registration.env).some((key) => /DEV_MCP|TOKEN|DESCRIPTOR/i.test(key))).toBe(
      false,
    )
    expect(Object.values(registration.env).some((value) => /^https?:\/\//.test(value))).toBe(false)
  })
})
