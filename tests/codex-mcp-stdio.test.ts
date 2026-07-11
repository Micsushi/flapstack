import { describe, expect, it } from "vitest"
import { resolveCodexStdioLaunch } from "../src/main/lib/codex/mcp-stdio"

describe("Codex MCP stdio launch resolution", () => {
  it("anchors explicit relative plugin paths to the Codex-provided cwd", () => {
    expect(
      resolveCodexStdioLaunch({
        command: "node",
        args: ["./mcp/server.mjs", "--config", "../shared/config.json"],
        cwd: "/plugins/sites/1.0.0",
      }),
    ).toEqual({
      command: "node",
      args: [
        "/plugins/sites/1.0.0/mcp/server.mjs",
        "--config",
        "/plugins/sites/shared/config.json",
      ],
      cwd: "/plugins/sites/1.0.0",
    })
  })

  it("anchors an explicitly relative executable and preserves ordinary arguments", () => {
    expect(
      resolveCodexStdioLaunch({
        command: "./bin/server",
        args: ["serve", "config.json"],
        cwd: "/plugins/example",
      }),
    ).toEqual({
      command: "/plugins/example/bin/server",
      args: ["serve", "config.json"],
      cwd: "/plugins/example",
    })
  })

  it("does not reinterpret paths when Codex reports no absolute cwd", () => {
    expect(
      resolveCodexStdioLaunch({
        command: "./server",
        args: ["./config.json"],
        cwd: ".",
      }),
    ).toEqual({
      command: "./server",
      args: ["./config.json"],
      cwd: undefined,
    })
  })
})
