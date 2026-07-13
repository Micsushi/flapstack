// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  ALL_SHORTCUT_ACTIONS,
  detectConflicts,
  getResolvedHotkey,
  migrateHotkeysConfig,
  validateHotkey,
} from "../src/renderer/lib/hotkeys"
import { AGENT_ACTIONS } from "../src/renderer/features/agents/lib/agents-actions"
import { resolveRendererShortcut } from "../src/renderer/features/agents/lib/agents-hotkeys-manager"

describe("shortcut registry", () => {
  it("shows only actions with a real runtime consumer", () => {
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
    expect(
      resolveRendererShortcut(
        new KeyboardEvent("keydown", { key: ",", code: "Comma", ctrlKey: true }),
        config,
      ),
    ).toBeNull()
  })
})
