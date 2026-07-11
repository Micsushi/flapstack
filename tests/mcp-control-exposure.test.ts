import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { buildMcpStdioRegistration } from "../src/main/lib/mcp-control/registration"

describe("Flapstack MCP per-chat exposure", () => {
  it("builds a launcher-owned stdio identity without caller-controlled arguments", () => {
    expect(
      buildMcpStdioRegistration(
        {
          chatId: "chat-1",
          runId: "run-1",
          permissionMode: "ask-before-edits",
        },
        {
          executablePath: "/Flapstack",
          mainDirectory: "/app/out/main",
          databasePath: "/user/data/agents.db",
        },
      ),
    ).toEqual({
      command: "/Flapstack",
      args: ["/app/out/main/mcp-control-stdio.js"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FLAPSTACK_MCP_CHAT_ID: "chat-1",
        FLAPSTACK_MCP_RUN_ID: "run-1",
        FLAPSTACK_MCP_PERMISSION_MODE: "ask-before-edits",
        FLAPSTACK_DB_PATH: "/user/data/agents.db",
      },
    })
  })

  it("migrates existing chats to exposure disabled", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0016_massive_ravenous.sql"),
      "utf8",
    )
    expect(migration).toContain("ADD `mcp_exposure_enabled` integer DEFAULT false NOT NULL")
  })
})
