#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const instance = process.env.FLAPSTACK_DEV_INSTANCE?.trim()
const expectedUserDataProfile =
  process.env.FLAPSTACK_DEV_MCP_PROFILE?.trim() ||
  (instance ? `Flapstack Dev ${instance.replace(/[^a-zA-Z0-9_-]/g, "-")}` : "Flapstack Dev")
const descriptorPath =
  process.env.FLAPSTACK_DEV_MCP_DESCRIPTOR ||
  join(
    homedir(),
    "Library",
    "Application Support",
    expectedUserDataProfile,
    "dev-test-control-mcp.json",
  )

let upstream = null

async function readDescriptor() {
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"))
  if (descriptor.profile !== expectedUserDataProfile) {
    throw new Error(`Refusing non-dev Flapstack profile: ${descriptor.profile || "unknown"}`)
  }
  if (resolve(descriptor.checkout) !== checkout) {
    throw new Error(`Flapstack Dev is running from a different checkout: ${descriptor.checkout}`)
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(descriptor.url) || !descriptor.token) {
    throw new Error("Invalid Flapstack Dev MCP descriptor")
  }
  return descriptor
}

async function getUpstream() {
  const descriptor = await readDescriptor()
  const signature = `${descriptor.url}:${descriptor.token}`
  if (upstream?.signature === signature) return upstream.client
  if (upstream) await upstream.transport.close().catch(() => undefined)

  const client = new Client({ name: "flapstack-dev-mcp-proxy", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
  })
  await client.connect(transport)
  upstream = { signature, client, transport }
  return client
}

async function forward(operation) {
  try {
    return await operation(await getUpstream())
  } catch (firstError) {
    if (upstream) await upstream.transport.close().catch(() => undefined)
    upstream = null
    try {
      return await operation(await getUpstream())
    } catch (secondError) {
      throw new Error(
        `Flapstack Dev MCP unavailable: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
        { cause: firstError },
      )
    }
  }
}

const server = new Server(
  { name: "flapstack-dev-mcp-proxy", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () =>
  forward((client) => client.listTools()),
)
server.setRequestHandler(CallToolRequestSchema, async (request) =>
  forward((client) =>
    client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
    }),
  ),
)

await server.connect(new StdioServerTransport())
