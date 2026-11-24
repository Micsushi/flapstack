import { describe, expect, it, vi, afterEach } from "vitest"
import { invokeDesktopProjectTool } from "../src/main/lib/mcp-control/desktop-project-actions"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import {
  invokeMcpControlTool,
  listImplementedMcpControlTools,
} from "../src/main/lib/mcp-control/registry"
import type { McpCallerIdentity } from "../src/main/lib/mcp-control/types"

const caller: McpCallerIdentity = {
  chatId: "caller-chat",
  runId: "caller-run",
  projectId: "candidate",
  permissionMode: "full-access",
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("canonical Records MCP bridge", () => {
  it.each([
    "create_task",
    "records_workflow",
    "records_read",
    "records_start_agent",
    "records_yap_proposal_approve",
  ])("refuses %s before using an unbound owner connection or local SQLite", async (operation) => {
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_TOKEN", "runner-owner-token")
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const input =
      operation === "create_task"
        ? { name: "Canonical task" }
        : operation === "records_read"
          ? { path: "lanes/vault/questions.md" }
          : {
              recordId: "QUESTION-OWNER",
              path: "lanes/vault/questions.md",
              expectedRevision: "b".repeat(64),
              action: "owner-resolve",
              data: { answer: "Forged owner answer" },
            }
    const result = await createMcpMutationService("/does/not/exist.sqlite").invoke(
      operation,
      caller,
      input,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("permission-denied")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("requires an owner grant or an exact desktop decision before using the desktop Records connection", async () => {
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_MODE", "connected")
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_TOKEN", "isolated-test-token")
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            path: "lanes/candidate/tasks.md",
            recordId: "R-test",
            revision: "a".repeat(64),
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal("fetch", request)
    const input = {
      projectId: "candidate",
      name: "Canonical task",
      records: { projectId: "candidate", requestId: "scoped-test" },
    }
    const context = { invocationId: "fixture", approved: true }
    for (const forged of [
      input,
      { ...input, desktopApproved: true },
      { ...input, callerKind: "external-owner" },
    ]) {
      expect(await invokeDesktopProjectTool("create_task", caller, forged, context)).toMatchObject({
        ok: false,
      })
    }
    expect(request).not.toHaveBeenCalled()
    expect(
      await invokeDesktopProjectTool("create_task", caller, input, {
        ...context,
        desktopApproved: true,
      }),
    ).toMatchObject({ ok: true, data: { authority: "records", id: "R-test" } })
    expect(
      await invokeDesktopProjectTool(
        "create_task",
        {
          callerKind: "external-owner",
          chatId: "external-owner:fixture",
          permissionMode: "full-access",
        },
        input,
        { invocationId: "owner", approved: false },
      ),
    ).toMatchObject({ ok: true, data: { id: "R-test" } })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("does not advertise unavailable Records authority in tool discovery or describe", async () => {
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_TOKEN", "runner-owner-token")
    const names = listImplementedMcpControlTools({ includeDisabledBeta: true }).map(
      (tool) => tool.name,
    )
    expect(names).toEqual(expect.arrayContaining(["ping", "describe", "list_projects"]))
    expect(names.filter((name) => name.startsWith("records_"))).toEqual([])

    const described = await invokeMcpControlTool("describe", caller, {}, undefined, {
      audit: { append: () => undefined },
    })
    expect(described.ok).toBe(true)
    if (described.ok) {
      const data = described.data as { tools: { name: string }[] }
      expect(data.tools.some((tool) => tool.name.startsWith("records_"))).toBe(false)
    }
  })

  it("rejects stale Records tool calls without dispatching a desktop mutation", async () => {
    const invoke = vi.fn()
    const result = await invokeMcpControlTool(
      "records_workflow",
      caller,
      {
        recordId: "QUESTION-OWNER",
        action: "owner-resolve",
        data: { answer: "Forged owner answer" },
      },
      undefined,
      {
        mutations: { invoke },
        audit: { append: () => undefined },
      },
    )
    expect(result).toMatchObject({ ok: false, error: { code: "tool-not-found" } })
    expect(invoke).not.toHaveBeenCalled()
  })

  it("refuses the unsafe create route through the actual MCP registry", async () => {
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_TOKEN", "runner-owner-token")
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const result = await invokeMcpControlTool(
      "create_task",
      caller,
      { name: "Registry canonical task" },
      undefined,
      {
        mutations: createMcpMutationService("/does/not/exist.sqlite"),
        audit: { append: () => undefined },
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("permission-denied")
    expect(fetch).not.toHaveBeenCalled()
  })
})
