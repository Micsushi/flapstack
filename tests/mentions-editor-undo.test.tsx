// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AgentsMentionsEditor } from "../src/renderer/features/agents/mentions/agents-mentions-editor"

vi.mock("../src/renderer/features/agents/mentions/agents-file-mention", () => ({
  createFileIconElement: () => document.createElement("span"),
}))
let root: Root
let container: HTMLDivElement
let editor: HTMLElement
beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(<AgentsMentionsEditor onTrigger={() => {}} onCloseTrigger={() => {}} />),
  )
  editor = container.querySelector("[contenteditable]")!
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function key(key: string, shiftKey = false) {
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  )
}
async function insert(text: string) {
  await act(async () => {
    editor.textContent = text
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }))
  })
}

describe("composer undo snapshots", () => {
  it("undoes a paste on the first shortcut after the debounce saved current text", async () => {
    await insert("pasted text")
    await act(async () => vi.advanceTimersByTime(500))
    await key("z")
    expect(editor.textContent).toBe("")
    await key("z", true)
    expect(editor.textContent).toBe("pasted text")
  })

  it("cancels a pending save so undo does not erase redo history", async () => {
    await insert("pasted text")
    await key("z")
    await act(async () => vi.advanceTimersByTime(500))
    expect(editor.textContent).toBe("")
    await key("z", true)
    expect(editor.textContent).toBe("pasted text")
  })
})
