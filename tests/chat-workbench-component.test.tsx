// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createChatWorkbenchLayout, reduceChatWorkbench } from "../src/shared/chat-workbench"
import { ChatWorkbench } from "../src/renderer/features/agents/workbench/chat-workbench"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function dragEvent(
  type: string,
  data: Record<string, string>,
  options: { dropEffect?: DataTransfer["dropEffect"]; screenX?: number; screenY?: number } = {},
) {
  const values = new Map(Object.entries(data))
  const dataTransfer = {
    dropEffect: options.dropEffect ?? "move",
    effectAllowed: "all",
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => values.set(format, value),
  } as DataTransfer
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    screenX: { value: options.screenX ?? 0 },
    screenY: { value: options.screenY ?? 0 },
  })
  return { event, dataTransfer }
}

describe("ChatWorkbench", () => {
  let root: Root
  let container: HTMLDivElement

  async function openPaneOptions() {
    const trigger = container.querySelector('[aria-label="Chat pane options"]') as HTMLButtonElement
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    })
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("renders four independently keyed interactive Chat panes with one shared workbench", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const renderChat = vi.fn((chatId: string) =>
      createElement("textarea", { "aria-label": `Composer ${chatId}`, defaultValue: chatId }),
    )

    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c", "d"].map((id) => ({ id, name: `Chat ${id}` })),
          layout,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat,
        }),
      ),
    )

    expect(container.querySelectorAll('[role="region"][aria-label^="Chat pane"]')).toHaveLength(4)
    expect(container.querySelectorAll("textarea")).toHaveLength(4)
    expect(renderChat.mock.calls.map(([chatId]) => chatId).sort()).toEqual(["a", "b", "c", "d"])
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(4)
  })

  it("offers keyboard split and announces the exact committed state", async () => {
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b"].map((id) => ({ id, name: `Chat ${id}` })),
          layout: createChatWorkbenchLayout(["a", "b"], "a"),
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    const shell = container.querySelector<HTMLElement>(
      '[role="application"][aria-label="Chat workbench"]',
    )!
    await act(async () =>
      shell.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    )
    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({ root: expect.objectContaining({ type: "split" }) }),
      expect.objectContaining({ type: "split", zone: "right" }),
    )
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Split Chat right")
  })

  it("suspends inactive tabs while retaining their tab identity", async () => {
    const renderChat = vi.fn((chatId: string) => createElement("div", null, `pane-${chatId}`))
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b"].map((id) => ({ id, name: id })),
          layout: createChatWorkbenchLayout(["a", "b"], "a"),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat,
        }),
      ),
    )

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(renderChat).toHaveBeenCalledTimes(1)
    expect(renderChat).toHaveBeenCalledWith("a", true)
  })

  it("keeps Save as workspace in the compact pane menu and announces the durable result", async () => {
    const onSaveAsWorkspace = vi.fn().mockResolvedValue("Saved as workspace Focus layout")
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          onSaveAsWorkspace,
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    await openPaneOptions()
    const button = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent === "Save as workspace")
    expect(button).toBeDefined()
    await act(async () => button!.click())

    expect(onSaveAsWorkspace).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Saved as workspace Focus layout",
    )
  })

  it("collapses a narrow workbench to one interactive pane without changing the logical layout", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const onLayoutChange = vi.fn()

    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c", "d"].map((id) => ({ id, name: `Chat ${id}` })),
          layout,
          viewport: { width: 500, height: 500 },
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    expect(container.querySelectorAll('[role="region"][aria-label^="Chat pane"]')).toHaveLength(1)
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4)
    expect(
      container.querySelector("[data-chat-workbench]")?.getAttribute("data-collapsed-groups"),
    ).toBe("3")
    expect(container.textContent).toContain("3 Chat panes are shown as tabs")
    expect(onLayoutChange).not.toHaveBeenCalled()
  })

  it("keeps transfer actions unavailable until a read-only Chat takes ownership", async () => {
    const move = vi.fn()
    const claim = vi.fn().mockResolvedValue("Chat ownership moved here.")
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          readOnlyChatIds: new Set(["a"]),
          onMoveToNewWindow: move,
          onClaimOwnership: claim,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    await openPaneOptions()
    const buttons = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(buttons.map((button) => button.textContent)).not.toContain("Move to new window")
    expect(buttons.map((button) => button.textContent)).not.toContain("Open read-only copy")
    expect(buttons.map((button) => button.textContent)).toContain("Take ownership here")
    await act(async () =>
      buttons.find((button) => button.textContent === "Take ownership here")!.click(),
    )
    expect(claim).toHaveBeenCalledWith("a")
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Chat ownership moved here.",
    )
  })

  it("reports a rejected editable transfer without an unhandled promise", async () => {
    const move = vi.fn().mockRejectedValue(new Error("Destination window is unavailable."))
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onMoveToNewWindow: move,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    await openPaneOptions()
    const moveButton = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (button) => button.textContent === "Move to new window",
    )!
    await act(async () => moveButton.click())
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Destination window is unavailable.",
    )
  })

  it("uses a twelve-pixel pointer target around the visible split divider", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a" }, { id: "b" }],
          layout,
          viewport: { width: 900, height: 500 },
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    expect(
      container.querySelector('[role="separator"]')?.getAttribute("data-pointer-hit-area"),
    ).toBe("12")
  })

  it("reports cumulative separator positions for assistive technology", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c"]), {
      type: "apply-preset",
      preset: "three-columns",
    }).layout
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a" }, { id: "b" }, { id: "c" }],
          layout,
          viewport: { width: 1_200, height: 500 },
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    expect(
      [...container.querySelectorAll('[role="separator"]')].map((separator) =>
        separator.getAttribute("aria-valuenow"),
      ),
    ).toEqual(["33", "67"])
  })

  it("routes an exact cross-window edge drop through the atomic transfer callback", async () => {
    const onCrossWindowDrop = vi.fn().mockResolvedValue("Moving Chat into the right pane")
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "b", name: "Chat b" }],
          layout: createChatWorkbenchLayout(["b"]),
          windowId: "window-2",
          onCrossWindowDrop,
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    const payload = JSON.stringify({
      chatId: "a",
      groupId: "source-group",
      sourceWindowId: "main",
    })
    const region = container.querySelector<HTMLElement>('[role="tablist"]')!
    await act(async () => {
      region.dispatchEvent(
        dragEvent("dragover", {
          "application/x-flapstack-chat-workbench": payload,
        }).event,
      )
    })
    const right = container.querySelector<HTMLElement>('[data-chat-drop-zone="right"]')!
    await act(async () => {
      right.dispatchEvent(
        dragEvent("dragover", {
          "application/x-flapstack-chat-workbench": payload,
        }).event,
      )
    })
    await act(async () => {
      right.dispatchEvent(
        dragEvent("drop", {
          "application/x-flapstack-chat-workbench": payload,
        }).event,
      )
    })

    expect(onCrossWindowDrop).toHaveBeenCalledWith(
      { chatId: "a", groupId: "source-group", sourceWindowId: "main" },
      { groupId: "chat-group-1", zone: "right" },
    )
    expect(onLayoutChange).not.toHaveBeenCalled()
  })

  it("offers a floating window only after a thresholded outside drag", async () => {
    const onDragOutside = vi.fn().mockResolvedValue("Moving Chat into a new floating window.")
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          windowId: "main",
          onDragOutside,
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const tab = container.querySelector<HTMLElement>('[role="tab"]')!
    const started = dragEvent("dragstart", {}, { screenX: 100, screenY: 100 })
    await act(async () => tab.dispatchEvent(started.event))
    const ended = dragEvent("dragend", {}, { dropEffect: "none", screenX: 160, screenY: 160 })
    await act(async () => tab.dispatchEvent(ended.event))

    expect(onDragOutside).toHaveBeenCalledWith(
      { chatId: "a", groupId: "chat-group-1", sourceWindowId: "main" },
      { screenX: 160, screenY: 160 },
    )
    expect(onLayoutChange).not.toHaveBeenCalled()
  })

  it("preserves the source when an outside drag is cancelled with Escape", async () => {
    const onDragOutside = vi.fn()
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onDragOutside,
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const tab = container.querySelector<HTMLElement>('[role="tab"]')!
    await act(async () =>
      tab.dispatchEvent(dragEvent("dragstart", {}, { screenX: 100, screenY: 100 }).event),
    )
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    )
    await act(async () =>
      tab.dispatchEvent(
        dragEvent("dragend", {}, { dropEffect: "none", screenX: 200, screenY: 200 }).event,
      ),
    )

    expect(onDragOutside).not.toHaveBeenCalled()
    expect(onLayoutChange).not.toHaveBeenCalled()
  })

  it("exposes an explicit existing-window destination affordance", async () => {
    const onMoveToExistingWindow = vi.fn().mockResolvedValue("Choose a destination.")
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onMoveToExistingWindow,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    await openPaneOptions()
    const move = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (button) => button.textContent === "Move to existing window…",
    )!
    await act(async () => move.click())
    expect(onMoveToExistingWindow).toHaveBeenCalledWith("a", "chat-group-1")
  })
})
