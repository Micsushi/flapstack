import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildClaudePermissionApplication,
  buildCodexPermissionApplication,
  buildLocalModelPermissionApplication,
  copyOnCreate,
  getGlobalDefault,
  getPermissionChangeBehavior,
  isClaudeMutatingTool,
  isClaudeReadOnlyToolAllowed,
  mapCodexAcpModeId,
  mapClaudeSdkPermissionMode,
  resolvePermission,
  resolveClaudeRuntimeToolPermission,
  resolveClaudeRuntimeToolPermissionWithoutBridge,
  setPermissionChangeBehavior,
  setGlobalDefault,
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
  it("resolves the nearest explicitly set mode", () => {
    expect(
      resolvePermission({
        chatMode: "read-only",
        taskMode: "full-access",
        projectMode: "auto-edit-project-only",
        globalMode: "ask-before-edits",
      }),
    ).toEqual({ mode: "read-only", source: "chat" })

    expect(
      resolvePermission({
        chatMode: null,
        taskMode: "full-access",
        projectMode: "auto-edit-project-only",
        globalMode: "ask-before-edits",
      }),
    ).toEqual({ mode: "full-access", source: "task" })

    expect(
      resolvePermission({
        chatMode: null,
        taskMode: null,
        projectMode: "auto-edit-project-only",
        globalMode: "ask-before-edits",
      }),
    ).toEqual({ mode: "auto-edit-project-only", source: "project" })
  })

  it("falls back to the global default and then the built-in default", () => {
    expect(resolvePermission({ globalMode: "full-access" })).toEqual({
      mode: "full-access",
      source: "global",
    })

    expect(resolvePermission({})).toEqual({
      mode: "ask-before-edits",
      source: "fallback",
    })
  })

  it("copies parent mode once for new children", () => {
    const copied: PermissionMode = copyOnCreate("full-access")

    expect(copied).toBe("full-access")
    expect(copyOnCreate(null, "read-only")).toBe("read-only")
    expect(copyOnCreate(null)).toBe("ask-before-edits")
  })

  it("persists the global default", () => {
    expect(getGlobalDefault()).toBe("ask-before-edits")

    setGlobalDefault("auto-edit-project-only")

    expect(getGlobalDefault()).toBe("auto-edit-project-only")
  })

  it("asks for permission-change scope by default and persists remembered behavior", () => {
    expect(getPermissionChangeBehavior()).toBe("ask")

    setPermissionChangeBehavior("all-chats")
    expect(getPermissionChangeBehavior()).toBe("all-chats")

    setPermissionChangeBehavior("current-chat")
    expect(getPermissionChangeBehavior()).toBe("current-chat")

    setPermissionChangeBehavior("ask")
    expect(getPermissionChangeBehavior()).toBe("ask")
  })

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

  it("reports missing cwd as unenforced for Codex ACP launch placement", () => {
    const application = buildCodexPermissionApplication({
      permissionMode: "read-only",
      cwd: null,
    })

    expect(application.enforced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "process-cwd", applied: false }),
        expect.objectContaining({ control: "acp-session-cwd", applied: false }),
        expect.objectContaining({ control: "codex-sandbox", value: "read-only" }),
      ]),
    )
  })

  it.each([
    ["read-only", "deny", "deny", "deny", "deny"],
    ["ask-before-edits", "ask", "ask", "ask", "ask"],
    ["auto-edit-project-only", "project-only", "deny", "deny", "deny"],
    ["full-access", "allow", "allow", "allow", "allow"],
  ] as const)(
    "maps local %s to exact project-write, shell, git, and network policies",
    (permissionMode, write, shell, git, network) => {
      const application = buildLocalModelPermissionApplication({
        permissionMode,
        cwd: "/tmp/project",
      })
      expect(application).toMatchObject({ applied: true, degraded: false })
      expect(application.enforced).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ control: "filesystem-write-scope", value: write }),
          expect.objectContaining({ control: "shell", value: shell }),
          expect.objectContaining({ control: "git", value: git }),
          expect.objectContaining({ control: "network", value: network }),
        ]),
      )
    },
  )

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

  it("reports Claude delegated permission limitations without overclaiming mid modes", () => {
    const application = buildClaudePermissionApplication({
      permissionMode: "ask-before-edits",
      cwd: "/tmp/project",
      sdkPermissionMode: "default",
      canUseToolReadOnlyGuard: false,
    })

    expect(application).toMatchObject({
      requested: "ask-before-edits",
      applied: false,
      degraded: true,
    })
    expect(application.enforced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "process-cwd", applied: true }),
        expect.objectContaining({ control: "filesystem-write-scope", applied: false }),
      ]),
    )
    expect(application.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "filesystem-write-scope" }),
        expect.objectContaining({ control: "mcp" }),
      ]),
    )
  })

  it.each([
    ["full-access", "write", "bypassPermissions", true],
    ["auto-edit-project-only", "write", "acceptEdits", false],
    ["read-only", "write", "dontAsk", false],
    ["ask-before-edits", "write", "default", false],
    ["custom", "write", "default", false],
    ["full-access", "plan", "plan", false],
  ] as const)(
    "maps %s/%s to Claude SDK permission mode %s",
    (permissionMode, chatMode, sdkPermissionMode, allowDangerouslySkipPermissions) => {
      expect(mapClaudeSdkPermissionMode(permissionMode, chatMode)).toEqual({
        sdkPermissionMode,
        allowDangerouslySkipPermissions,
      })
    },
  )

  it("recognizes known Claude mutating tools and write-like MCP tools", () => {
    expect(isClaudeMutatingTool("Write")).toBe(true)
    expect(isClaudeMutatingTool("MultiEdit")).toBe(true)
    expect(isClaudeMutatingTool("mcp__repo__update_file")).toBe(true)
    expect(isClaudeMutatingTool("Read")).toBe(false)
    expect(isClaudeMutatingTool("mcp__repo__list_files")).toBe(false)
  })

  it("allows only known read operations in Claude read-only mode", () => {
    for (const toolName of ["Read", "Glob", "Grep", "WebSearch", "AskUserQuestion", "Skill"]) {
      expect(isClaudeReadOnlyToolAllowed(toolName)).toBe(true)
    }
    for (const toolName of ["Write", "Bash", "Task", "mcp__repo__list_files", "FutureTool"]) {
      expect(isClaudeReadOnlyToolAllowed(toolName)).toBe(false)
    }
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

  it("fails closed when legacy Claude has no approval bridge", async () => {
    await expect(
      resolveClaudeRuntimeToolPermissionWithoutBridge({
        mode: "ask-before-edits",
        cwd: configDir,
        toolName: "Write",
        toolInput: { file_path: join("src", "inside.ts") },
      }),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringMatching(/approval bridge/i),
    })
  })
})
