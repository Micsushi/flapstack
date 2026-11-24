import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildCodexPermissionApplication,
  buildLocalModelPermissionApplication,
  mapCodexAcpModeId,
  claudeReadOnlyToolOptions,
  resolveClaudeRuntimeToolPermission,
  resolveClaudeRuntimeToolPermissionWithBridge,
  type PermissionMode,
} from "../src/main/lib/permissions"
import { disabledCustomPermissions } from "../src/shared/permission-capabilities"

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "flapstack-permissions-"))
  process.env.FLAPSTACK_CONFIG_DIR = configDir
})

afterEach(() => {
  delete process.env.FLAPSTACK_CONFIG_DIR
  rmSync(configDir, { recursive: true, force: true })
})

describe("permissions", () => {
  it("applies the Codex workspace mode and fail-closed approval bridge", () => {
    const application = buildCodexPermissionApplication({
      permissionMode: "auto-edit-project-only",
      cwd: "/tmp/project",
    })

    expect(application).toMatchObject({
      requested: "auto-edit-project-only",
      applied: true,
      degraded: false,
    })
    expect(application.enforced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "process-cwd", value: "/tmp/project" }),
        expect.objectContaining({ control: "acp-session-cwd", value: "/tmp/project" }),
        expect.objectContaining({ control: "codex-sandbox", value: "agent" }),
        expect.objectContaining({
          control: "codex-approval-policy",
          value: "flapstack-bridge",
        }),
      ]),
    )
    expect(application.limitations).toHaveLength(0)
  })

  it.each<[PermissionMode, string, boolean]>([
    ["read-only", "read-only", false],
    ["ask-before-edits", "read-only", false],
    ["auto-edit-project-only", "agent", false],
    ["full-access", "agent-full-access", false],
    ["custom", "read-only", true],
  ])("maps Codex %s to %s with truthful degradation", (permissionMode, modeId, degraded) => {
    const application = buildCodexPermissionApplication({ permissionMode, cwd: "/tmp/project" })

    expect(mapCodexAcpModeId(permissionMode)).toBe(modeId)
    expect(application.requested).toBe(permissionMode)
    expect(application.applied).toBe(!degraded)
    expect(application.degraded).toBe(degraded)
    expect(application.limitations.length > 0).toBe(degraded)
  })

  it("records explicit one-time approval for unexpected full-access escalations", () => {
    const application = buildCodexPermissionApplication({
      permissionMode: "full-access",
      cwd: "/tmp/project",
    })
    expect(application.enforced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "codex-approval-policy", value: "allow-once" }),
      ]),
    )
  })

  it("fails local custom permissions closed when their stored snapshot is invalid", () => {
    const application = buildLocalModelPermissionApplication({
      permissionMode: "custom",
      cwd: "/tmp/project",
      customPermissions: null,
    })
    expect(application).toMatchObject({ applied: false, degraded: true })
    expect(application.enforced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "filesystem-write-scope", value: "deny" }),
        expect.objectContaining({ control: "shell", value: "deny" }),
        expect.objectContaining({ control: "git", value: "deny" }),
        expect.objectContaining({ control: "network", value: "deny" }),
      ]),
    )
  })

  it("removes plan-file writes from the native read-only tool inventory", () => {
    const options = claudeReadOnlyToolOptions("read-only")
    expect(options.permissionMode).toBe("dontAsk")
    expect(options.tools).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "AskUserQuestion"]),
    )
    expect(options.tools).not.toContain("Write")
    expect(options.tools).not.toContain("Bash")
    expect(options.tools).not.toContain("ExitPlanMode")
    expect(claudeReadOnlyToolOptions("full-access")).toEqual({})
  })

  it("keeps direct Claude mid-level permissions inside their exact authority", async () => {
    const inside = join("src", "inside.ts")
    const outside = join(tmpdir(), "outside.ts")
    const custom = { ...disabledCustomPermissions, projectWrite: true }

    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "auto-edit-project-only",
        cwd: configDir,
        toolName: "Bash",
        toolInput: { command: "git status" },
      }),
    ).resolves.toBeNull()
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "ask-before-edits",
        cwd: configDir,
        toolName: "Read",
        toolInput: { file_path: inside },
      }),
    ).resolves.toMatchObject({ behavior: "allow" })
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "ask-before-edits",
        cwd: configDir,
        toolName: "Write",
        toolInput: { file_path: inside },
      }),
    ).resolves.toBeNull()
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "auto-edit-project-only",
        cwd: configDir,
        toolName: "Write",
        toolInput: { file_path: inside },
      }),
    ).resolves.toMatchObject({ behavior: "allow" })
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "auto-edit-project-only",
        cwd: configDir,
        toolName: "Write",
        toolInput: { file_path: outside },
      }),
    ).resolves.toMatchObject({ behavior: "deny" })
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "custom",
        customPermissions: custom,
        cwd: configDir,
        toolName: "Write",
        toolInput: { file_path: outside },
      }),
    ).resolves.toMatchObject({ behavior: "deny" })
    await expect(
      resolveClaudeRuntimeToolPermission({
        mode: "full-access",
        cwd: configDir,
        toolName: "Bash",
        toolInput: { command: "git status" },
      }),
    ).resolves.toMatchObject({ behavior: "allow" })
  })

  it("fails closed when the legacy Claude approval bridge denies or fails", async () => {
    const input = {
      mode: "ask-before-edits" as const,
      cwd: configDir,
      toolName: "Bash",
      toolInput: { command: "git status" },
    }
    await expect(
      resolveClaudeRuntimeToolPermissionWithBridge(input, async () => false),
    ).resolves.toMatchObject({ behavior: "deny" })
    await expect(
      resolveClaudeRuntimeToolPermissionWithBridge(input, async () => {
        throw new Error("bridge unavailable")
      }),
    ).resolves.toMatchObject({ behavior: "deny" })
  })
})
