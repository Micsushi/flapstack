import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CursorStreamTranslator } from "../src/main/lib/cursor/stream"
import { buildCursorArgs } from "../src/main/lib/cursor/args"
import { writeCursorProductMcpPlugin } from "../src/main/lib/cursor/product-mcp-plugin"
import { findReusableCursorPromptMessage } from "../src/main/lib/cursor/turn"

describe("cursor harness contract (D1)", () => {
  it("loads and approves an isolated run-scoped product MCP plugin", () => {
    const plugin = writeCursorProductMcpPlugin({
      command: "/Flapstack",
      args: ["/app/out/main/mcp-control-stdio.js"],
      env: { FLAPSTACK_MCP_CHAT_ID: "chat-1", FLAPSTACK_MCP_RUN_ID: "run-1" },
    })
    try {
      const manifest = JSON.parse(
        readFileSync(join(plugin.directory, ".cursor-plugin", "plugin.json"), "utf8"),
      )
      expect(manifest.mcpServers.flapstack).toMatchObject({
        type: "stdio",
        command: "/Flapstack",
        args: ["/app/out/main/mcp-control-stdio.js"],
      })
      expect(
        buildCursorArgs({
          model: "auto",
          cwd: "/tmp/project",
          permissionMode: "read-only",
          productMcpPluginDir: plugin.directory,
        }),
      ).toEqual(expect.arrayContaining(["--plugin-dir", plugin.directory, "--approve-mcps"]))
    } finally {
      plugin.cleanup()
    }
  })
})

describe("cursor stream translator (D2)", () => {
  it("flags structured failures even when process exit status could be zero", () => {
    const errorEvent = new CursorStreamTranslator()
    errorEvent.push({ type: "error", message: "Provider rejected the request" })
    expect(errorEvent.sawError()).toBe(true)

    const errorResult = new CursorStreamTranslator()
    const chunks = errorResult.push({ type: "result", subtype: "error", result: "Request failed" })
    expect(errorResult.sawError()).toBe(true)
    expect(chunks).toContainEqual({ type: "error", errorText: "Request failed" })
    expect(errorResult.getParts()).toEqual([])
  })
})

describe("cursor auth retry persistence (D3)", () => {
  const user = { id: "user-1", role: "user", parts: [{ type: "text", text: "retry me" }] }
  const partialAssistant = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "partial" }],
  }

  it("reuses the existing user turn after partial output during auth recovery", () => {
    expect(findReusableCursorPromptMessage([user, partialAssistant], "retry me", true)?.id).toBe(
      "user-1",
    )
  })
})
