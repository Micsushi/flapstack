import { randomUUID } from "node:crypto"
import { chmodSync, rmSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import {
  parseProductMcpRendererInvalidation,
  PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"

const MAX_EVENT_BYTES = 16_384
let activeProductMcpInvalidationEndpoint: string | null = null

export type ProductMcpInvalidationBridge = {
  endpoint: string
  stop: () => Promise<void>
}

export function createProductMcpInvalidationEndpoint(): string {
  const name = `flapstack-product-mcp-${process.pid}-${randomUUID()}`
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${name}`
    : join("/tmp", `fsmcp-${process.pid}-${randomUUID().slice(0, 8)}.sock`)
}

export function getProductMcpInvalidationEndpoint(): string | undefined {
  return activeProductMcpInvalidationEndpoint ?? process.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]
}

/** Main-process receiver for product stdio workers. This is not an MCP transport. */
export async function startProductMcpInvalidationBridge(options: {
  endpoint?: string
  onInvalidation: (event: ProductMcpRendererInvalidation) => void
}): Promise<ProductMcpInvalidationBridge> {
  const endpoint = options.endpoint ?? createProductMcpInvalidationEndpoint()
  if (process.platform !== "win32") rmSync(endpoint, { force: true })
  const server = createServer((socket) => {
    let buffered = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      buffered += chunk
      if (Buffer.byteLength(buffered) > MAX_EVENT_BYTES) {
        socket.destroy()
        return
      }
      let newline = buffered.indexOf("\n")
      while (newline >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        try {
          const event = parseProductMcpRendererInvalidation(JSON.parse(line))
          if (event) options.onInvalidation(event)
        } catch {
          // Malformed and non-product payloads never reach renderer IPC.
        }
        newline = buffered.indexOf("\n")
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  if (process.platform !== "win32") chmodSync(endpoint, 0o600)
  activeProductMcpInvalidationEndpoint = endpoint

  return {
    endpoint,
    stop: async () => {
      if (activeProductMcpInvalidationEndpoint === endpoint) {
        activeProductMcpInvalidationEndpoint = null
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (process.platform !== "win32") rmSync(endpoint, { force: true })
    },
  }
}

/** Best-effort post-commit notification. Database state remains authoritative. */
export async function publishProductMcpInvalidation(
  event: ProductMcpRendererInvalidation,
  endpoint = process.env[PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV],
): Promise<boolean> {
  const safe = parseProductMcpRendererInvalidation(event)
  if (!endpoint || !safe) return false
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(endpoint)
    let settled = false
    const finish = (sent: boolean) => {
      if (settled) return
      settled = true
      resolve(sent)
    }
    socket.once("connect", () => socket.end(`${JSON.stringify(safe)}\n`, () => finish(true)))
    socket.once("error", () => finish(false))
    socket.once("close", () => finish(false))
  })
}
