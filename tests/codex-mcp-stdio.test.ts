import { describe, expect, it } from "vitest"
import { resolve } from "node:path"
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
        resolve("/plugins/sites/1.0.0", "mcp/server.mjs"),
        "--config",
        resolve("/plugins/sites/1.0.0", "../shared/config.json"),
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
      command: resolve("/plugins/example", "bin/server"),
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
