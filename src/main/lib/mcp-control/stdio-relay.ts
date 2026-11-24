import { createConnection } from "node:net"
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { isJSONRPCRequest, isJSONRPCResultResponse } from "@modelcontextprotocol/sdk/types.js"
import { signedMcpHttpFetch } from "./http-auth"
import {
  productMcpLocalEndpointPid,
  readProductMcpRuntimePointer,
  validProductMcpHttpEndpoint,
} from "./live-discovery"
import { boundedMcpResult } from "./response-budget"
import type { McpCallerIdentity } from "./types"
import type { ToolExposure } from "./server"

export async function openDesktopMcpEndpoint() {
  const readPointer = () =>
    readProductMcpRuntimePointer(undefined, undefined, { failIfInvalid: true })
  const pointer = readPointer()
  if (!pointer) return null

  if (validProductMcpHttpEndpoint(pointer.controlEndpoint)) {
    const url = new URL(pointer.controlEndpoint)
    const reachable = await new Promise<boolean>((resolve) => {
      const probe = createConnection({ host: url.hostname, port: Number(url.port) })
      probe.once("connect", () => {
        probe.destroy()
        resolve(true)
      })
      probe.once("error", () => resolve(false))
      probe.setTimeout(2500, () => probe.destroy(new Error("Connection timed out.")))
    })
    if (reachable) return pointer.controlEndpoint
  }

  // A failed TCP probe alone does not establish that the desktop has stopped.
  // Signal zero checks process existence without sending a signal.
  const pid = productMcpLocalEndpointPid(pointer.invalidationEndpoint)
  if (pid !== null) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        const current = readPointer()
        if (
          !current ||
          (current.controlEndpoint === pointer.controlEndpoint &&
            current.invalidationEndpoint === pointer.invalidationEndpoint)
        )
          return null
      }
    }
  }
  throw new Error("Could not confirm the local Flapstack MCP endpoint.")
}

export async function relayDesktopMcpStdio(
  endpoint: string,
  caller: McpCallerIdentity,
  exposure: ToolExposure,
  stdio: StdioServerTransport,
) {
  const remote = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: signedMcpHttpFetch(endpoint, caller, exposure),
    reconnectionOptions: {
      initialReconnectionDelay: 250,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 1,
    },
  })
  remote.onmessage = (message) => {
    if (isJSONRPCResultResponse(message) && typeof message.result.protocolVersion === "string")
      remote.setProtocolVersion(message.result.protocolVersion)
    void stdio.send(message).catch(() => undefined)
  }
  stdio.onmessage = (message) => {
    const send = async () => {
      const offline = readProductMcpRuntimePointer()?.controlEndpoint !== endpoint
      let failure: {
        code: "tool-unavailable" | "invalid-caller" | "reconciliation-required"
        message: string
      }
      if (offline) {
        failure = {
          code: "tool-unavailable",
          message: "Reconnect to the running Flapstack profile.",
        }
      } else {
        try {
          await remote.send(message)
          return
        } catch (error) {
          failure =
            error instanceof StreamableHTTPError && error.code === 401
              ? {
                  code: "invalid-caller",
                  message: "The owner grant or active chat run is no longer valid.",
                }
              : {
                  code: "reconciliation-required",
                  message:
                    "The desktop could not confirm the request. Check the target or its audit before retrying.",
                }
        }
      }
      if (!isJSONRPCRequest(message)) return
      const response =
        message.method === "tools/call"
          ? {
              jsonrpc: "2.0" as const,
              id: message.id,
              result: boundedMcpResult({ ok: false, error: failure }),
            }
          : {
              jsonrpc: "2.0" as const,
              id: message.id,
              error: { code: -32000, message: failure.message },
            }
      await stdio.send(response)
    }
    void send().catch(() => undefined)
  }
  await remote.start()
  await stdio.start()
  return {
    close: async () => {
      await stdio.close()
      const timer = setTimeout(() => void remote.close(), 1500)
      timer.unref()
      try {
        await remote.terminateSession().catch(() => undefined)
      } finally {
        clearTimeout(timer)
        await remote.close()
      }
    },
  }
}
