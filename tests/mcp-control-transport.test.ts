import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterEach, describe, expect, it } from "vitest"
import { readMcpCallerIdentity } from "../src/main/lib/mcp-control/identity"

const transports: StdioClientTransport[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})

describe("Flapstack MCP stdio transport", () => {
  it("rejects startup without launcher-owned caller identity", () => {
    expect(() => readMcpCallerIdentity({})).toThrow(/launcher-provided caller identity/)
  })

  it("lists and calls ping and describe through a real stdio child", async () => {
    const entry = fileURLToPath(
      new URL("../src/main/lib/mcp-control/stdio-entry.ts", import.meta.url),
    )
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env: {
        PATH: process.env.PATH ?? "",
        FLAPSTACK_MCP_CHAT_ID: "chat-transport-test",
        FLAPSTACK_MCP_RUN_ID: "run-transport-test",
        FLAPSTACK_MCP_PERMISSION_MODE: "read-only",
      },
      stderr: "pipe",
    })
    transports.push(transport)
    const client = new Client({ name: "flapstack-test-client", version: "1.0.0" })
    await client.connect(transport)

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(["ping", "describe"])

    const ping = await client.callTool({ name: "ping", arguments: {} })
    expect(ping.structuredContent).toMatchObject({
      ok: true,
      data: { status: "ok", caller: { chatId: "chat-transport-test" } },
    })

    const describe = await client.callTool({ name: "describe", arguments: {} })
    expect(describe.structuredContent).toMatchObject({
      ok: true,
      data: { transport: "stdio" },
    })
    await client.close()
  })
})
