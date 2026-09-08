import { appendFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
const [configurationPath, receiptPath, mode, serverModule, transportModule, typesModule] =
  process.argv.slice(2)
const record = (event, extra = {}) =>
  appendFileSync(
    receiptPath,
    JSON.stringify({ event, pid: process.pid, at: Date.now(), ...extra }) + "\n",
  )
record("started", { nodeMajor: Number(process.versions.node.split(".")[0]) })
const configuration = JSON.parse(readFileSync(configurationPath, "utf8"))
const cwdVerified = readFileSync(resolve("cwd-proof.txt"), "utf8") === configuration.marker
const forbiddenAbsent =
  process.env.GITHUB_TOKEN === undefined && process.env.ANTHROPIC_AUTH_TOKEN === undefined
record("fixture-read", { cwdVerified, forbiddenAbsent })
const [{ Server }, { StdioServerTransport }, { ListToolsRequestSchema }] = await Promise.all([
  import(serverModule),
  import(transportModule),
  import(typesModule),
])
const server = new Server(
  { name: "synthetic-discovery", version: "1" },
  { capabilities: { tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  record("tools-list")
  if (mode === "stall") return new Promise(() => {})
  return {
    tools: [
      {
        name: cwdVerified ? "fixture_cwd_ok" : "fixture_cwd_failed",
        description: "Synthetic cwd check",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: forbiddenAbsent ? "fixture_environment_ok" : "fixture_environment_failed",
        description: "Synthetic environment check",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }
})
process.stdin.on("end", () => {
  record("stdin-ended")
  void server.close().finally(() => process.exit(0))
})
process.on("exit", (code) => record("exited", { code }))
await server.connect(new StdioServerTransport())
