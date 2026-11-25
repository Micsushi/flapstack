import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createExternalMcpRegistration } from "../src/main/lib/mcp-control/external-registration"
import {
  signExternalMcpProof,
  verifyExternalMcpProof,
} from "../src/main/lib/mcp-control/external-grant"
import { readMcpLaunch } from "../src/main/lib/mcp-control/identity"
import {
  appendMcpAuditRecord,
  listMcpDispatchRecoveryClaims,
} from "../src/main/lib/mcp-control/audit-storage"
import * as schema from "../src/main/lib/db/schema"

const directories: string[] = []
const entryPoint = resolve("src/main/mcp-control-stdio.ts")
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "flapstack-owner-mcp-"))
  directories.push(root)
  const configDir = join(root, "profile", "data")
  mkdirSync(configDir, { recursive: true })
  const databasePath = join(configDir, "agents.db")
  writeFileSync(databasePath, "")
  const issued = createExternalMcpRegistration({
    client: "claude",
    configDir,
    databasePath,
    entryPoint,
    executablePath: process.execPath,
    outputRoot: root,
    permissionMode: "read-only",
  })
  const config = JSON.parse(readFileSync(issued.configPath, "utf8")).mcpServers[
    "flapstack-app-control"
  ]
  return {
    root,
    configDir,
    databasePath,
    issued,
    config,
    token: readFileSync(config.env.FLAPSTACK_MCP_OWNER_TOKEN_FILE, "utf8"),
  }
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("external owner credentials", () => {
  it("derives the DB from the selected profile, ignores a requested permission upgrade, and fails closed on revocation", () => {
    const { root, configDir, issued, token } = fixture()
    const env: NodeJS.ProcessEnv = {
      FLAPSTACK_MCP_OWNER_TOKEN: token,
      FLAPSTACK_MCP_PERMISSION_MODE: "full-access",
    }
    const launch = readMcpLaunch(["--external", "--profile", join(root, "profile")], env)
    expect(launch.caller).toEqual({
      callerKind: "external-owner",
      chatId: "external-owner:" + issued.grantId,
      taskId: null,
      projectId: null,
      permissionMode: "read-only",
    })
    expect(env.FLAPSTACK_DB_PATH).toBe(realpathSync.native(join(configDir, "agents.db")))
    expect(env.FLAPSTACK_MCP_OWNER_TOKEN).toBeUndefined()
    expect(readFileSync(issued.grantPath, "utf8")).not.toContain(token.split(".")[1])
    unlinkSync(issued.grantPath)
    expect(launch.resolveExternal).toThrow(/revoked/)
  })

  it("requires an owner credential for the exact profile, rejects mixed child identities, and binds signatures to the request", () => {
    const first = fixture()
    const second = fixture()
    expect(() => readMcpLaunch(["--external"], {})).toThrow(/owner-issued/)
    expect(() =>
      readMcpLaunch(["--external"], { ...first.config.env, FLAPSTACK_MCP_RUN_ID: "child" }),
    ).toThrow(/child identity/)
    expect(() =>
      readMcpLaunch(["--external"], {
        ...first.config.env,
        FLAPSTACK_DB_PATH: second.databasePath,
      }),
    ).toThrow(/grant/)
    expect(() =>
      readMcpLaunch(["--external"], {
        ...first.config.env,
        FLAPSTACK_CONFIG_DIR: second.configDir,
      }),
    ).toThrow(/grant/)
    const proof = signExternalMcpProof(first.token, "nonce-a:ping")
    expect(verifyExternalMcpProof(first.databasePath, proof, "nonce-a:ping").callerKind).toBe(
      "external-owner",
    )
    expect(() => verifyExternalMcpProof(first.databasePath, proof, "nonce-b:ping")).toThrow(
      /signature/,
    )
    expect(() => verifyExternalMcpProof(second.databasePath, proof, "nonce-a:ping")).toThrow(
      /grant/,
    )
  })

  it("pings over stdio without a chat row and rechecks revocation on the next message", async () => {
    const { databasePath, config, issued } = fixture()
    const db = new Database(databasePath)
    try {
      migrate(drizzle(db), { migrationsFolder: resolve("drizzle") })
    } finally {
      db.close()
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", ...config.args],
      env: { ...config.env, PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    })
    const client = new Client({ name: "external-owner-test", version: "1" })
    const otherConnection = new Database(databasePath)
    const audit = drizzle(otherConnection, { schema })
    try {
      await client.connect(transport)
      // Another client has begun a request and is still producing its response.
      appendMcpAuditRecord(audit, {
        invocationId: "active-describe",
        status: "dispatch-started",
        caller: { chatId: "external-owner:" + issued.grantId, permissionMode: "read-only" },
        toolName: "describe",
        tier: 0,
        input: {},
      })
      const ping = () => client.callTool({ name: "ping", arguments: {} })
      expect((await ping()).structuredContent).toMatchObject({
        ok: true,
        data: {
          caller: { chatId: "external-owner:" + issued.grantId, permissionMode: "read-only" },
        },
      })
      expect(listMcpDispatchRecoveryClaims(audit)).toEqual([
        expect.objectContaining({ invocationId: "active-describe", state: "dispatch-started" }),
      ])
      unlinkSync(issued.grantPath)
      expect((await ping()).structuredContent).toMatchObject({
        ok: false,
        error: { code: "stale-caller" },
      })
    } finally {
      otherConnection.close()
      await client.close()
      await transport.close()
    }
  })
})
