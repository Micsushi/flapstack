import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { isWithinProjectBoundary } from "../src/main/lib/permission-boundary"
import { resolveProviderMcpPermission } from "../src/main/lib/mcp-control/provider-permissions"
import { buildOpencodePermissionConfig } from "../src/main/lib/harness/opencode-sidecar/permissions"
import {
  CUSTOM_PERMISSION_SCHEMA_VERSION,
  disabledCustomPermissions,
  getPermissionEligibility,
  parseCustomPermissionCapabilities,
} from "../src/shared/permission-capabilities"
import { isCustomToolAllowed } from "../src/main/lib/permissions"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("permission promotion", () => {
  it("migrates legacy custom toggles conservatively and rejects partial versioned state", () => {
    expect(
      parseCustomPermissionCapabilities({
        fileWrite: true,
        shell: false,
        network: false,
        git: true,
        browser: false,
        mcp: true,
        secrets: false,
      }),
    ).toMatchObject({
      schemaVersion: CUSTOM_PERMISSION_SCHEMA_VERSION,
      projectWrite: true,
      thirdPartyMcp: true,
      productMcpRead: true,
      productMcpWrite: false,
      productMcpTier3: false,
    })
    expect(
      parseCustomPermissionCapabilities({
        ...disabledCustomPermissions,
        projectWrite: undefined,
      }),
    ).toBeNull()
  })

  it("keeps project-only hidden for cwd/classifier providers", () => {
    expect(getPermissionEligibility("codex", "auto-edit-project-only")).toMatchObject({
      selectable: false,
      enforcement: "best-effort",
    })
    for (const harness of ["claude-code", "cursor-agent", "openrouter", "nanogpt"] as const) {
      expect(getPermissionEligibility(harness, "auto-edit-project-only").selectable).toBe(false)
    }
  })

  it("keeps custom product and third-party MCP capabilities separate", () => {
    const permissions = {
      ...disabledCustomPermissions,
      projectWrite: true,
      productMcpRead: true,
    }
    expect(
      resolveProviderMcpPermission({
        permissionMode: "custom",
        customPermissions: permissions,
        correlationId: "read",
        providerToolName: "mcp__flapstack__list_projects",
      }),
    ).toMatchObject({ source: "product", decision: "allow", productGateRequired: true })
    expect(
      resolveProviderMcpPermission({
        permissionMode: "custom",
        customPermissions: permissions,
        correlationId: "third-party",
        providerToolName: "mcp__github__list_issues",
      }),
    ).toMatchObject({ source: "third-party", decision: "deny" })
    expect(buildOpencodePermissionConfig("custom", permissions)).toEqual({
      edit: "allow",
      bash: "deny",
      webfetch: "deny",
    })
  })

  it("denies unknown custom tools even when every known capability is enabled", () => {
    const enabled = Object.fromEntries(
      Object.entries(disabledCustomPermissions).map(([key, value]) => [
        key,
        typeof value === "boolean" ? true : value,
      ]),
    ) as typeof disabledCustomPermissions

    expect(isCustomToolAllowed(enabled, "Read")).toBe(true)
    expect(isCustomToolAllowed(enabled, "SurpriseTool")).toBe(false)
  })

  it("rejects traversal and existing or dangling symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-boundary-root-"))
    const outside = await mkdtemp(join(tmpdir(), "flapstack-boundary-outside-"))
    roots.push(root, outside)
    await mkdir(join(root, "src"))
    await writeFile(join(root, "src", "safe.ts"), "ok")
    await symlink(outside, join(root, "escape"))
    await symlink(join(outside, "missing"), join(root, "dangling"))

    await expect(isWithinProjectBoundary(root, "src/safe.ts")).resolves.toBe(true)
    await expect(isWithinProjectBoundary(root, "src/new.ts")).resolves.toBe(true)
    await expect(isWithinProjectBoundary(root, "../outside.ts")).resolves.toBe(false)
    await expect(isWithinProjectBoundary(root, "escape/file.ts")).resolves.toBe(false)
    await expect(isWithinProjectBoundary(root, "dangling/file.ts")).resolves.toBe(false)
  })
})
