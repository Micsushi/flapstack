import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CredentialService,
  resetCredentialServiceForTests,
  setCredentialServiceForTests,
} from "../src/main/lib/credential-service"
import {
  hydrateMcpServerSecrets,
  migrateClaudeMcpSecretFiles,
  protectMcpServerSecrets,
  sanitizeMcpServerConfig,
} from "../src/main/lib/mcp-secrets"
import {
  getProjectMcpConfigApprovalId,
  isProjectMcpConfigApproved,
} from "../src/main/lib/trpc/routers/claude-settings"

const roots: string[] = []

afterEach(() => {
  resetCredentialServiceForTests()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("MCP configuration trust and secret boundaries", () => {
  it("invalidates project approval whenever path or config content changes", () => {
    const servers = { local: { command: "node", args: ["server.js"] } }
    const approval = getProjectMcpConfigApprovalId("C:/project", servers)
    const approved = new Set([approval])

    expect(isProjectMcpConfigApproved("C:/project", servers, approved)).toBe(true)
    expect(
      isProjectMcpConfigApproved(
        "C:/project",
        { local: { command: "node", args: ["changed.js"] } },
        approved,
      ),
    ).toBe(false)
    expect(isProjectMcpConfigApproved("C:/other", servers, approved)).toBe(false)
  })

  it("persists bearer and OAuth material only in the encrypted opaque store", () => {
    const storageDir = mkdtempSync(join(tmpdir(), "flapstack-mcp-secrets-"))
    roots.push(storageDir)
    setCredentialServiceForTests(
      new CredentialService({
        storageDir,
        encryption: {
          inspect: () => ({ available: true, backend: "test" }),
          encrypt: (secret) => Buffer.from(secret, "utf8"),
          decrypt: (ciphertext) => ciphertext.toString("utf8"),
        },
      }),
    )
    const config = {
      url: "https://mcp.example.test",
      authType: "oauth" as const,
      headers: { Authorization: "Bearer secret-access" },
      _oauth: {
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        clientId: "client-id",
      },
    }

    const protectedConfig = protectMcpServerSecrets("C:/project", "server", config)
    expect(protectedConfig).not.toHaveProperty("headers")
    expect(protectedConfig).not.toHaveProperty("_oauth")
    expect(JSON.stringify(protectedConfig)).not.toContain("secret-access")
    expect(readFileSync(join(storageDir, "credentials.v1.json"), "utf8")).not.toContain(
      "secret-access",
    )

    expect(hydrateMcpServerSecrets(protectedConfig)).toMatchObject(config)
    expect(
      JSON.stringify(sanitizeMcpServerConfig(hydrateMcpServerSecrets(protectedConfig))),
    ).not.toContain("secret-access")
  })

  it("defers legacy migration without rewriting plaintext when persistence is unavailable", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "flapstack-mcp-deferred-store-"))
    const configDir = mkdtempSync(join(tmpdir(), "flapstack-mcp-deferred-config-"))
    roots.push(storageDir, configDir)
    setCredentialServiceForTests(
      new CredentialService({
        storageDir,
        encryption: {
          inspect: () => ({ available: false, backend: "unavailable" }),
          encrypt: () => {
            throw new Error("must not persist")
          },
          decrypt: () => {
            throw new Error("must not decrypt")
          },
        },
      }),
    )
    const primary = join(configDir, "primary.json")
    const original = JSON.stringify({ mcpServers: { primary: secretServer("deferred") } })
    writeFileSync(primary, original)

    await expect(
      migrateClaudeMcpSecretFiles({
        primary,
        directoryConfig: join(configDir, "missing-directory.json"),
        directoryMcp: join(configDir, "missing-mcp.json"),
      }),
    ).resolves.toEqual({ migrated: 0, deferred: 1 })
    expect(readFileSync(primary, "utf8")).toBe(original)
  })
})

function secretServer(suffix: string) {
  return {
    url: "https://mcp.example.test",
    headers: { Authorization: `Bearer secret-${suffix}` },
  }
}
