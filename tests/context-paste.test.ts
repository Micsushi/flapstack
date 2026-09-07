// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { pasteFromContextMenu } from "../src/renderer/features/agents/utils/context-paste"
import { handlePasteEvent } from "../src/renderer/features/agents/utils/paste-text"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
let editor: HTMLElement
let read: ReturnType<typeof vi.fn>
beforeEach(() => {
  editor = document.createElement("div")
  editor.setAttribute("contenteditable", "true")
  document.body.append(editor)
  read = vi.fn().mockResolvedValue("pasted")
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: { clipboardRead: read },
  })
  vi.stubGlobal(
    "DataTransfer",
    class {
      items: unknown[] = []
      text = ""
      setData(_type: string, text: string) {
        this.text = text
      }
      getData() {
        return this.text
      }
    },
  )
  vi.stubGlobal(
    "ClipboardEvent",
    class extends Event {
      clipboardData: DataTransfer
      constructor(type: string, options: ClipboardEventInit) {
        super(type, options)
        this.clipboardData = options.clipboardData!
      }
    },
  )
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn((_command, _ui, text) => {
      const range = window.getSelection()!.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(text))
      return true
    }),
  })
})
afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, "desktopApi")
  Reflect.deleteProperty(document, "execCommand")
  Reflect.deleteProperty(navigator, "clipboard")
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("composer context paste", () => {
  it("uses browser clipboard only when the desktop bridge is absent", async () => {
    Reflect.deleteProperty(window, "desktopApi")
    const browserRead = vi.fn().mockResolvedValue("browser paste")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: browserRead },
    })
    await pasteFromContextMenu(editor, null)
    expect(browserRead).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    expect(editor.textContent).toBe("browser paste")
  })

  it("does not read clipboard for an already disabled editor", async () => {
    editor.setAttribute("contenteditable", "false")
    await pasteFromContextMenu(editor, null)
    expect(read).not.toHaveBeenCalled()
  })

  it("retains the inline size limit when no paste handler is present", async () => {
    read.mockResolvedValue("x".repeat(12_000))
    await pasteFromContextMenu(editor, null)
    expect(editor.textContent).toHaveLength(10_000)
    expect(toast.warning).toHaveBeenCalledOnce()
  })
  it("uses the desktop bridge and dispatches normal paste/input events", async () => {
    const paste = vi.fn()
    const input = vi.fn()
    editor.addEventListener("paste", paste)
    editor.addEventListener("input", input)
    await pasteFromContextMenu(editor, null)
    expect(read).toHaveBeenCalledOnce()
    expect(paste).toHaveBeenCalledOnce()
    expect(input).toHaveBeenCalledOnce()
    expect(editor.textContent).toBe("pasted")
  })

  it("routes large text through the existing attachment handler", async () => {
    const attach = vi.fn().mockResolvedValue(undefined)
    const text = "x".repeat(6_001)
    read.mockResolvedValue(text)
    editor.addEventListener("paste", (event) =>
      handlePasteEvent(event as unknown as React.ClipboardEvent, vi.fn(), attach),
    )
    await pasteFromContextMenu(editor, null)
    expect(attach).toHaveBeenCalledWith(text)
    expect(editor.textContent).toBe("")
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it("replaces only a selection inside the editor", async () => {
    editor.textContent = "before selected after"
    const range = document.createRange()
    range.setStart(editor.firstChild!, 7)
    range.setEnd(editor.firstChild!, 15)
    await pasteFromContextMenu(editor, range)
    expect(editor.textContent).toBe("before pasted after")
  })

  it("never restores a selection in another editable surface", async () => {
    const outside = document.createElement("div")
    outside.textContent = "Do not replace"
    document.body.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    await pasteFromContextMenu(editor, range)
    expect(outside.textContent).toBe("Do not replace")
    expect(editor.textContent).toBe("pasted")
  })

  it.each(["removed", "disabled"])(
    "ignores clipboard results after the editor is %s",
    async (state) => {
      read.mockImplementation(async () => {
        if (state === "removed") editor.remove()
        else editor.setAttribute("contenteditable", "false")
        return "late text"
      })
      await pasteFromContextMenu(editor, null)
      expect(document.execCommand).not.toHaveBeenCalled()
    },
  )

  it("reports clipboard failure without echoing its contents", async () => {
    read.mockRejectedValue(new Error("private clipboard detail"))
    await pasteFromContextMenu(editor, null)
    expect(toast.error).toHaveBeenCalledWith("Could not read clipboard", expect.any(Object))
    expect(document.execCommand).not.toHaveBeenCalled()
  })
})
