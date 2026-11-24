import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"
import { projectMcpServers } from "../src/main/lib/agent-runtime/antigravity/project-mcp"

it("sends the reviewed servers only for their approved chat and exact configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-project-mcp-"))
  const ctx = {
    runId: "run",
    chatId: "chat",
    signal: new AbortController().signal,
  } as RuntimeAdapterContext
  const approvals = new Map<string, string>()
  const permission = vi.fn(async () => ({ decision: "acceptForSession" }))
  const warn = vi.fn()
  const load = () => projectMcpServers(root, false, ctx, approvals, permission, warn)
  try {
    expect(await load()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    await mkdir(join(root, ".agents"))
    const config = join(root, ".agents", "mcp_config.json")
    const servers = {
      ledger: { command: "node", args: ["lookup.cjs"], env: { FIXTURE: "private-fixture-value" } },
      filtered: { command: "node", disabledTools: ["edit"] },
      off: { command: "node", disabled: true },
    }
    await writeFile(config, JSON.stringify({ mcpServers: servers }))
    expect(await load()).toEqual([
      {
        name: "ledger",
        command: "node",
        args: ["lookup.cjs"],
        env: [{ name: "FIXTURE", value: "private-fixture-value" }],
      },
    ])
    expect(JSON.stringify(permission.mock.calls)).not.toContain("private-fixture-value")
    expect(warn).toHaveBeenCalled()
    await load()
    expect(permission).toHaveBeenCalledTimes(1)
    permission.mockResolvedValue({ decision: "decline" })
    ctx.chatId = "different"
    expect(await load()).toEqual([])
    ctx.chatId = "chat"
    servers.ledger.args = ["different.cjs"]
    await writeFile(config, JSON.stringify({ mcpServers: servers }))
    expect(await load()).toEqual([])
    expect(permission).toHaveBeenCalledTimes(3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
