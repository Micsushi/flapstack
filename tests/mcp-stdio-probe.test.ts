import { afterEach, expect, it, vi } from "vitest"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname, basename } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { resolveCodexStdioLaunch } from "../src/main/lib/codex/mcp-stdio"

// Shell discovery, config access and Electron UI are isolated; MCP SDK transport/server remain real.
const adapter = vi.hoisted(() => ({ environment: {} as Record<string, string>, configCalls: 0 }))
vi.mock("../src/main/lib/claude/env", () => ({
  getClaudeShellEnvironment: () => adapter.environment,
}))
vi.mock("../src/main/lib/claude-config", () => {
  const forbidden = () => {
    adapter.configCalls++
    throw new Error("Config access is outside this probe")
  }
  return {
    getMcpServerConfig: forbidden,
    readClaudeConfig: forbidden,
    updateClaudeConfigAtomic: forbidden,
    updateMcpServerConfig: forbidden,
    GLOBAL_MCP_PATH: "synthetic-only",
    CLAUDE_CONFIG_PATH: "synthetic-only",
    CLAUDE_DIR_CONFIG_PATH: "synthetic-only",
    CLAUDE_DIR_MCP_PATH: "synthetic-only",
  }
})
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => process.env.USERPROFILE, isReady: () => false },
  BrowserWindow: class {
    constructor() {
      throw new Error("No UI allowed")
    }
  },
  shell: {
    openExternal: () => {
      throw new Error("No external UI allowed")
    },
  },
  safeStorage: { isEncryptionAvailable: () => false },
}))
const require = createRequire(import.meta.url)
let directory: string | undefined
const ownedChildren: number[] = []
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
afterEach(() => {
  vi.unstubAllEnvs()
  if (directory && !ownedChildren.some(alive)) {
    const target = resolve(directory)
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("flapstack-mcp-probe-")
    )
      throw new Error("Refusing cleanup outside exact fixture root")
    rmSync(target, { recursive: true, force: true })
  }
  directory = undefined
})

it("discovers real stdio tools in configured cwd with safe environment and observes child cleanup on success and abort", async () => {
  const runtime =
    process.env.FLAPSTACK_TEST_NODE22 ||
    (Number(process.versions.node.split(".")[0]) === 22 ? process.execPath : undefined)
  if (!runtime)
    throw new Error(
      "Set FLAPSTACK_TEST_NODE22 to an installed Node22 executable for this real-child test",
    )
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-probe-"))
  const home = join(directory, "isolated-home"),
    fixture = join(directory, "fixture")
  mkdirSync(join(home, ".codex"), { recursive: true })
  mkdirSync(fixture)
  const sentinels = [join(home, ".claude.json"), join(home, ".codex", "config.toml")]
  sentinels.forEach((path) => writeFileSync(path, "synthetic-config-unchanged"))
  vi.stubEnv("HOME", home)
  vi.stubEnv("USERPROFILE", home)
  vi.stubEnv("CODEX_HOME", join(home, ".codex"))
  adapter.environment = {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    GITHUB_TOKEN: "synthetic-forbidden-token",
    ANTHROPIC_AUTH_TOKEN: "synthetic-forbidden-token",
  }
  copyFileSync(resolve("tests/fixtures/mcp-stdio-probe/server.mjs"), join(fixture, "server.mjs"))
  writeFileSync(join(fixture, "fixture.json"), JSON.stringify({ marker: "cwd-proof" }))
  writeFileSync(join(fixture, "cwd-proof.txt"), "cwd-proof")
  const { fetchMcpToolsStdio } = await import("../src/main/lib/mcp-auth")
  const receipts: unknown[] = []
  for (const mode of ["success", "stall"]) {
    const receipt = join(fixture, `${mode}.jsonl`)
    const events = (): Array<{
      event: string
      pid: number
      at: number
      nodeMajor?: number
      cwdVerified?: boolean
      forbiddenAbsent?: boolean
      code?: number
    }> =>
      existsSync(receipt)
        ? readFileSync(receipt, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : []
    const launch = resolveCodexStdioLaunch({
      command: runtime,
      args: [
        "./server.mjs",
        "./fixture.json",
        receipt,
        mode,
        ...["server/index.js", "server/stdio.js", "types.js"].map(
          (path) => pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${path}`)).href,
        ),
      ],
      cwd: fixture,
    })
    const controller = new AbortController(),
      startedAt = Date.now()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let childPid: number | undefined
    try {
      const pending = fetchMcpToolsStdio(
        { ...launch, command: launch.command!, env: { ELECTRON_RUN_AS_NODE: "1" } },
        controller.signal,
      )
      await vi.waitFor(
        () => {
          const started = events().find((e) => e.event === "started")
          expect(started).toBeDefined()
          childPid = started!.pid
          if (!ownedChildren.includes(childPid)) ownedChildren.push(childPid)
        },
        { timeout: 8000, interval: 25 },
      )
      await vi.waitFor(() => expect(events().some((e) => e.event === "tools-list")).toBe(true), {
        timeout: 8000,
        interval: 25,
      })

      expect(events()[0]!.nodeMajor).toBe(22)
      expect(events().find((e) => e.event === "fixture-read")).toMatchObject({
        cwdVerified: true,
        forbiddenAbsent: true,
      })
      if (mode === "stall") controller.abort()
      const tools = await pending,
        returnedAt = Date.now(),
        aliveAtHelperReturn = alive(childPid)
      expect(tools).toEqual(
        mode === "stall"
          ? []
          : [
              { name: "fixture_cwd_ok", description: "Synthetic cwd check" },
              { name: "fixture_environment_ok", description: "Synthetic environment check" },
            ],
      )
      await vi.waitFor(() => expect(alive(childPid!)).toBe(false), { timeout: 5000, interval: 25 })
      expect(events().some((e) => e.event === "exited")).toBe(true)
      receipts.push({
        mode,
        startedAt,
        returnedAt,
        childPid,
        aliveAtHelperReturn,
        terminatedObservedAt: Date.now(),
        events: events(),
      })
    } finally {
      clearTimeout(timer)
      controller.abort()
      // Observe SDK cleanup even when startup/assertions fail. Never kill a possibly reused PID.
      const started = events().find((e) => e.event === "started")
      if (started && !ownedChildren.includes(started.pid)) ownedChildren.push(started.pid)
      if (started)
        await vi.waitFor(() => expect(alive(started.pid)).toBe(false), {
          timeout: 5000,
          interval: 25,
        })
    }
  }
  expect(adapter.configCalls).toBe(0)
  expect(sentinels.map((path) => readFileSync(path, "utf8"))).toEqual([
    "synthetic-config-unchanged",
    "synthetic-config-unchanged",
  ])
  if (process.env.FLAPSTACK_TEST_MCP_RECEIPT)
    writeFileSync(
      process.env.FLAPSTACK_TEST_MCP_RECEIPT,
      JSON.stringify(
        {
          scope: "SDK stdio discovery only",
          adapterSeams: ["Electron UI", "shell environment discovery", "config-access guard"],
          configAccessCalls: adapter.configCalls,
          sdkTransportMocked: false,
          isolatedConfigSentinelsUnchanged: true,
          receipts,
        },
        null,
        2,
      ),
    )
}, 25_000)
