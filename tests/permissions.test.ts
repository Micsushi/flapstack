import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildClaudePermissionApplication,
  buildCodexPermissionApplication,
  copyOnCreate,
  getGlobalDefault,
  isClaudeMutatingTool,
  mapClaudeSdkPermissionMode,
  resolvePermission,
  setGlobalDefault,
  type PermissionMode,
} from "../src/main/lib/permissions"

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

  it("reports cwd as the only enforced Codex ACP launch control", () => {
    const application = buildCodexPermissionApplication({
      permissionMode: "auto-edit-project-only",
      cwd: "/tmp/project",
    })

    expect(application).toMatchObject({
      requested: "auto-edit-project-only",
      applied: false,
      degraded: true,
    })
    expect(application.enforced).toEqual([
      expect.objectContaining({
        control: "process-cwd",
        applied: true,
        value: "/tmp/project",
      }),
      expect.objectContaining({
        control: "acp-session-cwd",
        applied: true,
        value: "/tmp/project",
      }),
    ])
    expect(application.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "codex-sandbox" }),
        expect.objectContaining({ control: "filesystem-write-scope" }),
      ]),
    )
  })

  it.each<PermissionMode>([
    "read-only",
    "ask-before-edits",
    "auto-edit-project-only",
    "full-access",
    "custom",
  ])("does not overclaim Codex ACP enforcement for %s", (permissionMode) => {
    const application = buildCodexPermissionApplication({ permissionMode, cwd: "/tmp/project" })

    expect(application.requested).toBe(permissionMode)
    expect(application.applied).toBe(false)
    expect(application.degraded).toBe(true)
    expect(application.limitations.length).toBeGreaterThan(0)
    expect(application.warnings.join(" ")).toContain("not")
  })

  it("reports missing cwd as unenforced for Codex ACP launch placement", () => {
    const application = buildCodexPermissionApplication({
      permissionMode: "read-only",
      cwd: null,
    })

    expect(application.enforced).toEqual([
      expect.objectContaining({ control: "process-cwd", applied: false }),
      expect.objectContaining({ control: "acp-session-cwd", applied: false }),
    ])
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
    ["full-access", "agent", "bypassPermissions", true],
    ["auto-edit-project-only", "agent", "acceptEdits", false],
    ["read-only", "agent", "dontAsk", false],
    ["ask-before-edits", "agent", "default", false],
    ["custom", "agent", "default", false],
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
})
