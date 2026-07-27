import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`)
    const [name, inline] = value.slice(2).split("=", 2)
    result[name] = inline ?? argv[++index]
  }
  return result
}

function resultValue(response) {
  if (response?.structuredContent && "result" in response.structuredContent) {
    return response.structuredContent.result
  }
  const text = response?.content?.find((item) => item.type === "text")?.text
  return text ? JSON.parse(text) : null
}

async function waitForReceipt(call, fingerprint, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const environment = resultValue(await call("get_test_environment"))
    if (environment?.app?.lastProtocolEvent?.urlFingerprint === fingerprint) return environment
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for the primary app to record the protocol activation")
}

export async function verifyWindowsDeepLink(options = {}) {
  if (process.platform !== "win32")
    throw new Error("Windows deep-link verification requires Windows")
  const profile = options.profile ?? resolveDevMcpProfile(process.env)
  const descriptorPath =
    options.descriptor ??
    resolveDevMcpDescriptorPath(profile, {
      platform: "win32",
      env: process.env,
    })
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"))
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
  })
  const client = new Client({ name: "flapstack-stage5-deep-link", version: "1.0.0" })
  await client.connect(transport)
  const call = async (name, input = {}) =>
    client.callTool({ name, arguments: input }, undefined, { timeout: 30_000 })

  try {
    const before = resultValue(await call("get_test_environment"))
    const expectedChannel = options.channel ?? before.app.channel
    if (before.app.channel !== expectedChannel) {
      throw new Error(`Expected ${expectedChannel} app, received ${before.app.channel}`)
    }
    if (before.app.windowCount !== 1) {
      throw new Error(
        `Deep-link proof requires exactly one initial window, found ${before.app.windowCount}`,
      )
    }
    if (descriptor.profile !== profile || descriptor.userDataPath !== before.app.userDataPath) {
      throw new Error("Descriptor/profile identity does not match the live app")
    }

    const nonce = randomBytes(16).toString("hex")
    const url = `${before.app.protocol}://stage5-proof/receipt?nonce=${nonce}`
    const fingerprint = createHash("sha256").update(url).digest("hex")
    const args = before.app.defaultApp
      ? [before.app.appPath, url, "--no-focus", "--start-minimized"]
      : [url, "--no-focus", "--start-minimized"]
    const env = {
      ...process.env,
      FLAPSTACK_NO_FOCUS: "1",
      FLAPSTACK_START_MINIMIZED: "1",
      FLAPSTACK_WINDOW_DISPLAY: "secondary",
      ...(descriptor.rendererUrl ? { ELECTRON_RENDERER_URL: descriptor.rendererUrl } : {}),
    }
    delete env.ELECTRON_RUN_AS_NODE
    const second = spawnSync(before.app.executablePath, args, {
      cwd: before.repo?.path ?? process.cwd(),
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    })
    if (second.error) throw second.error
    if (second.status !== 0) {
      throw new Error(
        `Second-instance protocol activation failed (${second.status}): ${String(second.stderr).trim()}`,
      )
    }

    const after = await waitForReceipt(call, fingerprint)
    const event = after.app.lastProtocolEvent
    if (
      after.app.processId !== before.app.processId ||
      after.app.userDataPath !== before.app.userDataPath ||
      after.app.protocol !== before.app.protocol ||
      after.app.windowCount !== before.app.windowCount ||
      event.accepted !== true ||
      event.source !== "second-instance" ||
      event.activated !== false ||
      event.windowCountAfter !== before.app.windowCount
    ) {
      throw new Error(
        "Protocol activation crossed identity, activated focus, or created a duplicate window",
      )
    }
    return {
      ok: true,
      channel: after.app.channel,
      profile,
      protocol: after.app.protocol,
      processId: after.app.processId,
      userDataPath: after.app.userDataPath,
      windowCount: after.app.windowCount,
      receipt: event,
    }
  } finally {
    await transport.close()
  }
}

const direct =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (direct) {
  verifyWindowsDeepLink(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
