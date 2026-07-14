// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  ALL_SHORTCUT_ACTIONS,
  buildShortcutState,
  detectConflicts,
  getResolvedHotkey,
  migrateHotkeysConfig,
  mutateShortcutConfig,
  parseHotkeysConfig,
  validateHotkey,
} from "../src/renderer/lib/hotkeys"
import {
  AGENT_ACTIONS,
  executeAgentAction,
} from "../src/renderer/features/agents/lib/agents-actions"
import { resolveRendererShortcut } from "../src/renderer/features/agents/lib/agents-hotkeys-manager"
import {
  parseDevRendererControlRequest,
  parseDevRendererControlResponse,
} from "../src/shared/dev-renderer-control"

describe("shortcut registry", () => {
  it("shows only actions with a real runtime consumer", () => {
    expect(ALL_SHORTCUT_ACTIONS.map((action) => action.id)).not.toEqual(
      expect.arrayContaining([
        "new-agent",
        "archive-agent",
        "open-in-editor",
        "open-file-in-editor",
        "open-kanban",
      ]),
    )
    for (const action of ALL_SHORTCUT_ACTIONS) {
      expect(action.dispatch === "local" || AGENT_ACTIONS[action.actionId]).toBeTruthy()
    }
  })

  it("uses platform defaults and ignores overrides for fixed native actions", () => {
    const config = { version: 2 as const, bindings: { "open-settings": "cmd+x" } }
    expect(getResolvedHotkey("open-settings", config, "darwin")).toBe("cmd+,")
    expect(getResolvedHotkey("open-settings", config, "win32")).toBe("ctrl+,")
  })

  it("migrates only valid editable v1 bindings", () => {
    expect(
      migrateHotkeysConfig({
        version: 1,
        bindings: { "toggle-sidebar": "SHIFT+CMD+B", "open-settings": "cmd+x", nope: "x" },
      }),
    ).toEqual({ version: 2, bindings: { "toggle-sidebar": "cmd+shift+b" } })
  })

  it("rejects invalid and reserved bindings", () => {
    expect(validateHotkey("cmd+q", "darwin")).toMatchObject({ valid: false })
    expect(validateHotkey("cmd+shift+k", "darwin")).toEqual({
      valid: true,
      hotkey: "cmd+shift+k",
    })
    expect(validateHotkey("alt+f4", "win32")).toMatchObject({ valid: false })
    expect(validateHotkey("ctrl+alt+delete", "linux")).toMatchObject({ valid: false })
    expect(validateHotkey("cmd+cmd+k", "darwin")).toMatchObject({
      valid: false,
      reason: "Duplicate modifier",
    })
  })

  it("parses malformed persisted state safely and preserves diagnostics", () => {
    expect(getResolvedHotkey("toggle-sidebar", { version: 1 }, "darwin")).toBe("cmd+\\")
    expect(getResolvedHotkey("toggle-sidebar", { version: 2, bindings: null }, "darwin")).toBe(
      "cmd+\\",
    )
    expect(
      parseHotkeysConfig(
        { version: 1, bindings: { "toggle-sidebar": "cmd+q", removed: "cmd+x" } },
        "darwin",
      ).diagnostics,
    ).toEqual([
      { actionId: "toggle-sidebar", reason: "Reserved by the operating system" },
      { actionId: "removed", reason: "Unknown shortcut action" },
    ])
  })

  it("uses one validated mutation path and returns sanitized state", () => {
    const initial = { version: 2 as const, bindings: {} }
    const changed = mutateShortcutConfig(
      initial,
      { operation: "set", actionId: "toggle-sidebar", hotkey: "ctrl+shift+b" },
      "linux",
    )
    expect(changed).toMatchObject({ ok: true })
    if (!changed.ok) throw new Error(changed.error)
    expect(changed.config.bindings).toEqual({ "toggle-sidebar": "ctrl+shift+b" })
    expect(
      mutateShortcutConfig(
        changed.config,
        { operation: "set", actionId: "toggle-sidebar", hotkey: "ctrl+p" },
        "linux",
      ),
    ).toMatchObject({ ok: false, error: "Go to file already uses this shortcut" })
    const state = buildShortcutState({ ...changed.config, secret: "do-not-return" }, "linux")
    expect(state).not.toHaveProperty("secret")
    expect(state.actions.find((action) => action.id === "toggle-sidebar")).toMatchObject({
      resolvedBinding: "ctrl+shift+b",
      defaultBinding: "ctrl+\\",
    })
  })

  it("consumes every editable binding through a real action effect", async () => {
    const effects = {
      setSettingsActiveTab: vi.fn(),
      setDesktopView: vi.fn(),
      setSidebarOpen: vi.fn(),
      toggleChatSearch: vi.fn(),
      setFileSearchDialogOpen: vi.fn(),
    }
    const context = {
      ...effects,
      selectedChatId: "chat-1",
      hasSelectedProject: true,
      desktopView: null,
    }
    for (const action of ALL_SHORTCUT_ACTIONS.filter((item) => item.editable)) {
      const before = Object.values(effects).reduce((count, fn) => count + fn.mock.calls.length, 0)
      await expect(executeAgentAction(action.actionId, context, "hotkey")).resolves.toMatchObject({
        success: true,
      })
      const after = Object.values(effects).reduce((count, fn) => count + fn.mock.calls.length, 0)
      expect(after, action.id).toBeGreaterThan(before)
    }
  })

  it("reports conflicts without overwriting either action", () => {
    const config = {
      version: 2 as const,
      bindings: { "toggle-sidebar": "cmd+p" },
    }
    expect(detectConflicts(config, "darwin").get("toggle-sidebar")?.conflictingActionIds).toContain(
      "file-search",
    )
  })

  it("dispatches changed bindings immediately and protects editable focus", () => {
    const config = { version: 2 as const, bindings: { "file-search": "cmd+shift+p" } }
    const workspace = document.createElement("div")
    const input = document.createElement("input")
    workspace.append(input)
    document.body.append(workspace)

    let workspaceAction: string | null = null
    workspace.addEventListener("keydown", (event) => {
      workspaceAction = resolveRendererShortcut(event as KeyboardEvent, config)?.id ?? null
    })
    workspace.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        code: "KeyP",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )
    expect(workspaceAction).toBe("file-search")

    let inputAction: string | null = "unset"
    input.addEventListener("keydown", (event) => {
      inputAction = resolveRendererShortcut(event as KeyboardEvent, config)?.id ?? null
    })
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        code: "KeyP",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )
    expect(inputAction).toBeNull()

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "\\",
        code: "Backslash",
        ctrlKey: true,
        bubbles: true,
      }),
    )
    expect(inputAction).toBe("toggle-sidebar")
  })

  it("protects terminals, Monaco, and dialogs and leaves native accelerators to Electron", () => {
    const config = { version: 2 as const, bindings: {} }
    for (const target of [
      Object.assign(document.createElement("div"), { className: "xterm" }),
      Object.assign(document.createElement("div"), { className: "monaco-editor" }),
      Object.assign(document.createElement("div"), { role: "dialog" }),
    ]) {
      if (target.role) target.setAttribute("role", target.role)
      let action: string | null = "unset"
      target.addEventListener("keydown", (event) => {
        action = resolveRendererShortcut(event as KeyboardEvent, config)?.id ?? null
      })
      document.body.append(target)
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true, bubbles: true }),
      )
      expect(action).toBeNull()
    }

    const mainSource = readFileSync("src/main/index.ts", "utf8")
    expect(mainSource).toContain('accelerator: "CmdOrCtrl+,"')
    expect(mainSource).toContain('accelerator: "CmdOrCtrl+N"')
    expect(ALL_SHORTCUT_ACTIONS.some((action) => action.id === "archive-agent")).toBe(false)
    const activeChatSource = readFileSync(
      "src/renderer/features/agents/main/active-chat.tsx",
      "utf8",
    )
    expect(activeChatSource).not.toContain("for Cmd+W bulk close")
    expect(
      resolveRendererShortcut(
        new KeyboardEvent("keydown", { key: ",", code: "Comma", ctrlKey: true }),
        config,
      ),
    ).toBeNull()
  })

  it("does not capture unavailable contextual actions", () => {
    const event = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
    })
    expect(
      resolveRendererShortcut(
        event,
        { version: 2, bindings: {} },
        {
          availableActionIds: new Set(["toggle-sidebar"]),
        },
      ),
    ).toBeNull()
  })

  it("bounds the authenticated renderer shortcut-control DTO", () => {
    const requestId = "1234567890abcdef"
    expect(
      parseDevRendererControlRequest({ requestId, command: "shortcuts.get", platform: "darwin" }),
    ).toMatchObject({ command: "shortcuts.get" })
    expect(
      parseDevRendererControlRequest({
        requestId,
        command: "shortcuts.mutate",
        operation: "set",
        actionId: "toggle-sidebar",
        hotkey: "cmd+shift+b",
      }),
    ).toMatchObject({ command: "shortcuts.mutate", operation: "set" })
    expect(
      parseDevRendererControlRequest({ requestId, command: "shortcuts.mutate", operation: "drop" }),
    ).toBeNull()
    expect(parseDevRendererControlRequest({ requestId, command: "renderer.eval" })).toBeNull()
    expect(parseDevRendererControlResponse({ requestId, ok: "yes" })).toBeNull()
  })
})
