import { randomUUID } from "node:crypto"
import { chmodSync, rmSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import {
  invalidationForProjectVaultChange,
  parseProductMcpRendererInvalidation,
  PRODUCT_MCP_INVALIDATION_CHANNEL,
  PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV,
  type ProjectVaultRendererChange,
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

/** Publish a committed main-process mutation through the same all-window bridge. */
export function publishLocalProductInvalidation(event: ProductMcpRendererInvalidation): void {
  const endpoint = getProductMcpInvalidationEndpoint()
  if (endpoint) void publishProductMcpInvalidation(event, endpoint)
}

export function publishLocalProjectVaultInvalidation(change: ProjectVaultRendererChange): void {
  try {
    publishLocalProductInvalidation(invalidationForProjectVaultChange(change))
  } catch {
    // Notification is best effort after the durable mutation has committed.
  }
}

export function publishLocalProjectVaultGraphInvalidation(projectId: string): void {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["vaults"],
    projectIds: [projectId],
  })
}

type ProductInvalidationWindow = {
  isDestroyed: () => boolean
  webContents: {
    isDestroyed?: () => boolean
    send: (channel: string, payload: ProductMcpRendererInvalidation) => void
  }
}

/** Send once to every live renderer. Receivers only invalidate queries and never rebroadcast. */
export function broadcastProductInvalidationToWindows(
  event: ProductMcpRendererInvalidation,
  windows: readonly ProductInvalidationWindow[],
): number {
  const safe = parseProductMcpRendererInvalidation(event)
  if (!safe) return 0
  let sent = 0
  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed?.()) continue
    try {
      window.webContents.send(PRODUCT_MCP_INVALIDATION_CHANNEL, safe)
      sent += 1
    } catch {
      // A renderer can disappear between the liveness check and send.
    }
  }
  return sent
}
