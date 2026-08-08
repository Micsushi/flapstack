// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  collectChatGroups,
  createChatWorkbenchLayout,
  reduceChatWorkbench,
} from "../src/shared/chat-workbench"
import { ChatWorkbench } from "../src/renderer/features/agents/workbench/chat-workbench"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function dragEvent(
  type: string,
  data: Record<string, string>,
  options: {
    dropEffect?: DataTransfer["dropEffect"]
    screenX?: number
    screenY?: number
    clientX?: number
    clientY?: number
  } = {},
) {
  const values = new Map(Object.entries(data))
  const dataTransfer = {
    dropEffect: options.dropEffect ?? "move",
    effectAllowed: "all",
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => values.set(format, value),
    setDragImage: vi.fn(),
  } as DataTransfer
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    screenX: { value: options.screenX ?? 0 },
    screenY: { value: options.screenY ?? 0 },
    clientX: { value: options.clientX ?? 0 },
    clientY: { value: options.clientY ?? 0 },
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
    expect(container.textContent).not.toContain("Group 1")
    expect(container.textContent).not.toContain("Group 2")
  })

  it("opens one movable Terminal presentation for a Chat", async () => {
    let layout = createChatWorkbenchLayout(["a"])
    let openTerminal: ((chatId: string) => void) | null = null
    const renderWorkbench = () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout,
          onLayoutChange: (nextLayout) => {
            layout = nextLayout
            renderWorkbench()
          },
          onActiveChatChange: vi.fn(),
          renderChat: (_presentationId, _active, controls) => {
            openTerminal = controls.openTerminal
            return createElement("div")
          },
        }),
      )

    await act(async () => renderWorkbench())
    await act(async () => openTerminal?.("a"))
    await act(async () => openTerminal?.("a"))

    const presentationIds = collectChatGroups(layout.root).flatMap((group) => group.chatIds)
    expect(presentationIds.filter((id) => id === "terminal:a")).toHaveLength(1)
    expect(container.querySelector('[aria-label^="Terminal pane"]')).not.toBeNull()
  })

  it("uses the compact hover scrollbar inside every pane tab bar", async () => {
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c"].map((id) => ({ id, name: `Chat ${id}` })),
          layout: createChatWorkbenchLayout(["a", "b", "c"]),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    expect(container.querySelector("[data-chat-pane-scrollbar]")).not.toBeNull()
    expect(container.querySelector('[role="tablist"]')?.className).toContain("scrollbar-hide")
  })

  it("offers move and new-group actions when a pane tab is right-clicked", async () => {
    const onCreateGroupFromChat = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          savedGroups: [
            { id: "current", name: "Current group" },
            { id: "other", name: "Other group" },
          ],
          activeSavedGroupId: "current",
          onMoveChatToMainBar: vi.fn(),
          onMoveChatToGroup: vi.fn(),
          onCreateGroupFromChat,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    await act(async () => {
      container
        .querySelector<HTMLElement>('[role="tab"]')!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }))
    })
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining(["Move", "Add to new group", "Close presentation"]),
    )

    const create = items.find((item) => item.textContent === "Add to new group")!
    await act(async () => create.click())
    expect(onCreateGroupFromChat).toHaveBeenCalledWith("a")
  })

  it("shows an unseen completion dot in the close position until the pane is used", async () => {
    const onChatViewed = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a", hasUnseenChanges: true }],
          layout: createChatWorkbenchLayout(["a"]),
          onChatViewed,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    expect(container.querySelector('[data-chat-unseen-indicator="a"]')).not.toBeNull()
    expect(
      container
        .querySelector('[aria-label="Close Chat a presentation"] svg')
        ?.getAttribute("class"),
    ).toContain("opacity-0")

    await act(async () =>
      container
        .querySelector<HTMLElement>('[role="region"]')!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    )
    expect(onChatViewed).toHaveBeenCalledWith("a")
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
    expect(renderChat).toHaveBeenCalledWith(
      "a",
      true,
      expect.objectContaining({ openTerminal: expect.any(Function) }),
    )
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
    const claim = vi.fn().mockResolvedValue("Chat ownership moved here.")
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          readOnlyChatIds: new Set(["a"]),
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

  it("keeps window transfer commands out of the pane menu", async () => {
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    await openPaneOptions()
    const commands = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (button) => button.textContent,
    )
    expect(commands).not.toContain("Move to new window")
    expect(commands).not.toContain("Open read-only copy")
    expect(commands).not.toContain("Move to existing window…")
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

  it("draws the active pane outline above its headers without removing project accents", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [
            { id: "a", accentColor: "#22c55e" },
            { id: "b", accentColor: "#f97316" },
          ],
          layout,
          viewport: { width: 900, height: 500 },
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    const activePane = container.querySelector<HTMLElement>('[data-active-group="true"]')
    const inactivePane = container.querySelector("[data-chat-group]:not([data-active-group])")
    expect(activePane?.querySelector("[data-active-pane-outline]")).not.toBeNull()
    expect(inactivePane?.querySelector("[data-active-pane-outline]")).toBeNull()
    expect(activePane?.className).not.toContain("ring-inset")
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-chat-tab]")].map(
        (tab) => tab.style.borderTopColor,
      ),
    ).toEqual(["rgb(34, 197, 94)", "rgb(249, 115, 22)"])
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

  it("links equivalent width dividers across a two-by-two layout", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c", "d"].map((id) => ({ id })),
          layout,
          viewport: { width: 900, height: 900 },
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    const separators = [...container.querySelectorAll('[role="separator"]')]
    expect(separators).toHaveLength(3)
    expect(
      separators.filter((separator) => separator.getAttribute("aria-orientation") === "vertical"),
    ).toHaveLength(2)
    expect(
      separators.filter((separator) => separator.getAttribute("aria-orientation") === "horizontal"),
    ).toHaveLength(1)

    const topVertical = separators.find(
      (separator) => separator.getAttribute("aria-orientation") === "vertical",
    )
    Object.defineProperty(topVertical?.parentElement, "clientWidth", {
      configurable: true,
      value: 900,
    })
    await act(async () =>
      topVertical?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    )
    const resized = onLayoutChange.mock.calls.at(-1)?.[0]
    expect(resized.root.children[0].sizes[0]).toBeCloseTo(0.55)
    expect(resized.root.children[0].sizes[1]).toBeCloseTo(0.45)
    expect(resized.root.children[1].sizes[0]).toBeCloseTo(0.55)
    expect(resized.root.children[1].sizes[1]).toBeCloseTo(0.45)
  })

  it("previews divider movement locally and commits the durable layout once", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b"].map((id) => ({ id })),
          layout,
          viewport: { width: 900, height: 600 },
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )

    const separator = container.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(separator.parentElement, "clientWidth", {
      configurable: true,
      value: 900,
    })
    await act(async () => {
      separator.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 450 }),
      )
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 520 }))
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 540 }))
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 540 }))
    })

    expect(onLayoutChange).toHaveBeenCalledOnce()
    expect(onLayoutChange.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ type: "resize-split" }),
    )
    expect(onLayoutChange.mock.calls[0]?.[0].root.sizes).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.4),
    ])
  })

  it("routes a contextual cross-window edge drop through the atomic transfer callback", async () => {
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
    const region = container.querySelector<HTMLElement>('[role="region"]')!
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    await act(async () => {
      region.dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 795, clientY: 300 },
        ).event,
      )
    })
    const overlay = container.querySelector<HTMLElement>('[data-chat-drop-overlay="right"]')!
    expect(overlay).not.toBeNull()
    expect(overlay.style.left).toBe("50%")
    expect(overlay.style.width).toBe("50%")
    expect(container.querySelector("[data-chat-drop-zone]")).toBeNull()
    await act(async () => {
      region.dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 795, clientY: 300 },
        ).event,
      )
    })

    expect(onCrossWindowDrop).toHaveBeenCalledWith(
      { chatId: "a", groupId: "source-group", sourceWindowId: "main" },
      { groupId: "chat-group-1", zone: "right" },
    )
    expect(onLayoutChange).not.toHaveBeenCalled()
  })

  it("moves one VS Code-style preview rectangle between edge and center targets", async () => {
    const onCrossWindowDrop = vi.fn().mockResolvedValue("Moved")
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "b", name: "Chat b" }],
          layout: createChatWorkbenchLayout(["b"]),
          windowId: "window-2",
          onCrossWindowDrop,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const pane = container.querySelector<HTMLElement>('[role="region"]')!
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const payload = JSON.stringify({ chatId: "a", groupId: "source", sourceWindowId: "main" })
    await act(async () => {
      pane.dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 160, clientY: 300 },
        ).event,
      )
    })
    const leftOverlay = container.querySelector<HTMLElement>('[data-chat-drop-overlay="left"]')!
    expect(leftOverlay).not.toBeNull()
    expect(leftOverlay.style.width).toBe("50%")
    expect(leftOverlay.style.height).toBe("calc(100% - 40px)")
    await act(async () => {
      pane.dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 400, clientY: 300 },
        ).event,
      )
    })
    const centerOverlay = container.querySelector<HTMLElement>('[data-chat-drop-overlay="tab"]')!
    expect(centerOverlay).toBe(leftOverlay)
    expect(centerOverlay.style.width).toBe("100%")
    expect(centerOverlay.style.height).toBe("calc(100% - 40px)")
    await act(async () => {
      pane.dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 160, clientY: 300 },
        ).event,
      )
    })
    expect(onCrossWindowDrop).toHaveBeenCalledWith(
      { chatId: "a", groupId: "source", sourceWindowId: "main" },
      { groupId: "chat-group-1", zone: "left" },
    )
  })

  it("does not rerender an active Chat for repeated dragover events in the same drop zone", async () => {
    const renderChat = vi.fn((chatId: string) => createElement("div", null, chatId))
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b"].map((id) => ({ id, name: `Chat ${id}` })),
          layout: createChatWorkbenchLayout(["a", "b"], "a"),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat,
        }),
      ),
    )
    const pane = container.querySelector<HTMLElement>('[role="region"]')!
    const boundsSpy = vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const payload = JSON.stringify({
      chatId: "b",
      groupId: "chat-group-1",
      sourceWindowId: "main",
    })
    const initialRenderCount = renderChat.mock.calls.length

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        pane.dispatchEvent(
          dragEvent(
            "dragover",
            { "application/x-flapstack-chat-workbench": payload },
            { clientX: 10, clientY: 300 },
          ).event,
        )
      })
    }

    expect(renderChat).toHaveBeenCalledTimes(initialRenderCount)
    expect(boundsSpy).toHaveBeenCalledOnce()
  })

  it("uses the dragged-over tab midpoint as the insertion position", async () => {
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c"].map((id) => ({ id, name: `Chat ${id}` })),
          layout: createChatWorkbenchLayout(["a", "b", "c"]),
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const tabs = container.querySelectorAll<HTMLElement>('[draggable="true"]:not([role="tablist"])')
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 300,
      top: 0,
      bottom: 32,
      width: 200,
      height: 32,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    const started = dragEvent("dragstart", {}, { screenX: 20, screenY: 20 })
    await act(async () => tabs[0].dispatchEvent(started.event))
    const payload = started.dataTransfer.getData("application/x-flapstack-chat-workbench")
    await act(async () => {
      tabs[1].dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 280, clientY: 12 },
        ).event,
      )
    })
    expect(tabs[1].getAttribute("data-chat-tab-drop-side")).toBe("right")
    await act(async () => {
      tabs[1].dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 280, clientY: 12 },
        ).event,
      )
    })
    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({
        root: expect.objectContaining({ chatIds: ["b", "a", "c"] }),
      }),
      expect.objectContaining({ type: "move-tab", chatId: "a", toIndex: 2 }),
    )
  })

  it("uses the middle half of a pane tab to move the Chat into that pane", async () => {
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c"].map((id) => ({ id, name: `Chat ${id}` })),
          layout: createChatWorkbenchLayout(["a", "b", "c"]),
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const tabs = container.querySelectorAll<HTMLElement>('[draggable="true"]:not([role="tablist"])')
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 300,
      top: 0,
      bottom: 32,
      width: 200,
      height: 32,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    const started = dragEvent("dragstart", {}, { screenX: 20, screenY: 20 })
    await act(async () => tabs[0].dispatchEvent(started.event))
    const payload = started.dataTransfer.getData("application/x-flapstack-chat-workbench")
    await act(async () =>
      tabs[1].dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 200, clientY: 12 },
        ).event,
      ),
    )
    expect(tabs[1].getAttribute("data-chat-tab-drop-side")).toBe("inside")
    expect(tabs[1].querySelector("[data-chat-tab-insertion]")).toBeNull()
    await act(async () =>
      tabs[1].dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 200, clientY: 12 },
        ).event,
      ),
    )
    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({
        root: expect.objectContaining({ activeChatId: "a", chatIds: ["b", "c", "a"] }),
      }),
      expect.objectContaining({ type: "move-tab", chatId: "a", toIndex: undefined }),
    )
  })

  it("drags the blank tab strip to move the entire pane with a contextual preview", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b"].map((id) => ({ id, name: `Chat ${id}` })),
          layout,
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const tabStrips = container.querySelectorAll<HTMLElement>("[data-chat-group-drag-handle]")
    const panes = container.querySelectorAll<HTMLElement>('[role="region"]')
    vi.spyOn(panes[1], "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const started = dragEvent("dragstart", {}, { screenX: 20, screenY: 20 })
    await act(async () => tabStrips[0].dispatchEvent(started.event))
    const payload = started.dataTransfer.getData("application/x-flapstack-chat-workbench")
    await act(async () => {
      panes[1].dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 795, clientY: 300 },
        ).event,
      )
    })
    expect(panes[1].querySelector('[data-chat-drop-overlay="right"]')).not.toBeNull()
    await act(async () => {
      panes[1].dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 795, clientY: 300 },
        ).event,
      )
    })
    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "move-group",
        fromGroupId: "chat-group-1",
        toGroupId: "chat-group-2",
        zone: "right",
      }),
    )
  })

  it("creates a split when a same-window sidebar Chat is dragged onto a pane edge", async () => {
    const onLayoutChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [
            { id: "a", name: "Chat a" },
            { id: "b", name: "Chat b" },
          ],
          layout: createChatWorkbenchLayout(["b"]),
          windowId: "main",
          onLayoutChange,
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const pane = container.querySelector<HTMLElement>('[role="region"]')!
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const payload = JSON.stringify({ chatId: "a", groupId: "sidebar", sourceWindowId: "main" })
    await act(async () => {
      pane.dispatchEvent(
        dragEvent(
          "dragover",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 160, clientY: 300 },
        ).event,
      )
    })
    await act(async () => {
      pane.dispatchEvent(
        dragEvent(
          "drop",
          { "application/x-flapstack-chat-workbench": payload },
          { clientX: 160, clientY: 300 },
        ).event,
      )
    })

    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({ root: expect.objectContaining({ type: "split" }) }),
      expect.objectContaining({ type: "split", chatId: "a", zone: "left" }),
    )
  })

  it("removes explicit layout and pop-out buttons from pane headers", async () => {
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: [{ id: "a", name: "Chat a" }],
          layout: createChatWorkbenchLayout(["a"]),
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    expect(container.querySelector('[aria-label="Choose Chat layout"]')).toBeNull()
    expect(container.querySelector('[aria-label="Move active Chat to new window"]')).toBeNull()
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
    expect(started.dataTransfer.effectAllowed).toBe("copyMove")
    expect(started.dataTransfer.getData("text/plain")).toBe("Chat a")
    expect(started.dataTransfer.setDragImage).toHaveBeenCalledOnce()
    expect(
      (vi.mocked(started.dataTransfer.setDragImage).mock.calls[0]?.[0] as HTMLElement).textContent,
    ).toContain("+")
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

  it("does not advertise a fifth split when four panes are already open", async () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: ["a", "b", "c", "d", "outside"].map((id) => ({ id, name: `Chat ${id}` })),
          layout,
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement("div", null, chatId),
        }),
      ),
    )
    const pane = container.querySelector<HTMLElement>('[role="region"]')!
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const payload = JSON.stringify({
      chatId: "outside",
      groupId: "sidebar",
      sourceWindowId: "main",
    })
    const dragging = dragEvent(
      "dragover",
      { "application/x-flapstack-chat-workbench": payload },
      { clientX: 80, clientY: 300 },
    )
    await act(async () => pane.dispatchEvent(dragging.event))
    expect(container.querySelector("[data-chat-drop-overlay]")).toBeNull()
    expect(dragging.dataTransfer.dropEffect).toBe("none")
  })
})
