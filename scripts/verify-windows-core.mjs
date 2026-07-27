import { spawnSync } from "node:child_process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { readFileSync } from "node:fs"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"
import { verifyWindowsDeepLink } from "./verify-windows-deep-link.mjs"

if (process.platform !== "win32") throw new Error("Windows core verification requires Windows")

const profile = resolveDevMcpProfile(process.env)
const descriptorPath = resolveDevMcpDescriptorPath(profile, {
  platform: "win32",
  env: process.env,
})
const deepLink = await verifyWindowsDeepLink({ profile, descriptor: descriptorPath })

const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"))
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
const client = new Client({ name: "flapstack-stage5-windows-core", version: "1.0.0" })
await client.connect(transport)
let credentialStatus
try {
  const response = await client.callTool(
    { name: "get_credential_status", arguments: {} },
    undefined,
    { timeout: 30_000 },
  )
  credentialStatus =
    response?.structuredContent && "result" in response.structuredContent
      ? response.structuredContent.result
      : JSON.parse(response?.content?.find((item) => item.type === "text")?.text ?? "null")
} finally {
  await transport.close()
}

const native = spawnSync(
  process.execPath,
  [
    "scripts/run-project-bin.mjs",
    "vitest",
    "vitest",
    "--",
    "run",
    "tests/windows-native-platform-live.test.ts",
    "tests/windows-terminal-profiles-live.test.ts",
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  },
)
if (native.error) throw native.error
if (native.status !== 0) {
  process.stderr.write(native.stdout)
  process.stderr.write(native.stderr)
  throw new Error(`Native Windows core verification failed with exit code ${native.status}`)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      deepLink,
      credentials: {
        inspected: true,
        statusShape: Array.isArray(credentialStatus) ? "array" : typeof credentialStatus,
      },
      nativeWindows: {
        dpapiLifecycle: "passed",
        terminalProfiles: ["powershell", "cmd"],
        isolatedScheduledTaskLifecycle: "passed-and-removed",
      },
    },
    null,
    2,
  ),
)
