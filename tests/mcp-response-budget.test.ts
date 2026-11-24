import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"
import { createMcpControlServer } from "../src/main/lib/mcp-control/server"
import {
  boundedMcpResult,
  budgetMcpDiff,
  MCP_RESPONSE_BYTES,
} from "../src/main/lib/mcp-control/response-budget"
import type { McpControlResponse } from "../src/main/lib/mcp-control/types"

describe("Flapstack MCP response budget", () => {
  it("pages a multibyte diff without breaking a code point or overrun", () => {
    const content = '\u6f22\u{1f98a}"\\\n'.repeat(17000)
    const first = budgetMcpDiff(content, 0, 2, "snapshot")
    const pair = budgetMcpDiff(content, 1, 1, "snapshot")
    expect(first.diff).toBe(content.slice(0, 1))
    expect(pair.diff).toBe("\u{1f98a}")
    const chunks: string[] = []
    let offset = 0
    do {
      const data = budgetMcpDiff(content, offset, 32_000, "snapshot")
      const response = boundedMcpResult({ ok: true, data })
      expect(
        Buffer.byteLength(
          JSON.stringify({ jsonrpc: "2.0", id: "x".repeat(128), result: response }),
        ),
      ).toBeLessThanOrEqual(MCP_RESPONSE_BYTES)
      expect(response.isError).toBe(false)
      chunks.push(data.diff)
      if (data.nextOffset === null) break
      expect(data.nextOffset).toBeGreaterThan(offset)
      offset = data.nextOffset
    } while (offset < content.length)
    expect(chunks.join("")).toBe(content)
  })

  it("returns a handle for a slow diff and revalidates the chat before reading it back", async () => {
    let stillVisible = true
    let finish!: (value: McpControlResponse) => void
    const work = new Promise<McpControlResponse>((resolve) => {
      finish = resolve
    })
    const server = createMcpControlServer(
      () => ({
        chatId: "control",
        projectId: "first",
        runId: "running",
        permissionMode: "read-only",
      }),
      () => work,
      "direct",
      (_, chatId) => {
        expect(chatId).toBe("target")
        if (!stillVisible) throw new Error("Chat moved to another project")
      },
    )
    const [first, second] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "slow-diff-fixture", version: "1" })
    await server.connect(first)
    try {
      await client.connect(second)
      const result = await client.callTool({
        name: "read_git_diff",
        arguments: { chatId: "target" },
      })
      expect(result.structuredContent).toMatchObject({
        ok: true,
        data: { status: "pending", pollTool: "dispatch_status", handle: expect.any(String) },
      })
      const { handle } = (result.structuredContent as { data: { handle: string } }).data
      finish({ ok: true, data: { diff: "previous project text" } })
      stillVisible = false
      const polled = await client.callTool({ name: "dispatch_status", arguments: { handle } })
      expect(polled.structuredContent).toMatchObject({
        ok: false,
        error: { code: "invalid-caller" },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
