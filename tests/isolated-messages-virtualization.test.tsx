// @vitest-environment jsdom
import { act, createElement, createRef, type ComponentType, type RefObject } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { appStore } from "../src/renderer/lib/jotai-store"

vi.mock("../src/renderer/features/agents/stores/message-store", async () => {
  const { atom } = await import("jotai")
  const { atomFamily } = await import("jotai/utils")
  return {
    userMessageIdsPerChatAtom: atomFamily((_subChatId: string) => atom<string[]>([])),
    messageGroupsPerChatAtom: atomFamily((_subChatId: string) =>
      atom<Array<{ userMsgId: string; assistantMsgIds: string[] }>>([]),
    ),
  }
})

vi.mock("../src/renderer/features/agents/main/isolated-message-group", async () => {
  const { createElement } = await import("react")
  return {
    IsolatedMessageGroup: ({ userMsgId, subChatId }: { userMsgId: string; subChatId: string }) =>
      createElement(
        "article",
        {
          "data-rendered-group": userMsgId,
          "data-rendered-sub-chat": subChatId,
          "data-user-message-id": userMsgId,
          style: { height: "80px" },
        },
        userMsgId,
        createElement("div", {
          "data-assistant-message-id": userMsgId
            .replace("-user-", "-assistant-")
            .replace(/^user-/, "assistant-"),
        }),
      ),
  }
})

import {
  findVisibleTranscriptAnchor,
  IsolatedMessagesSection,
} from "../src/renderer/features/agents/main/isolated-messages-section"
import {
  messageGroupsPerChatAtom,
  userMessageIdsPerChatAtom,
} from "../src/renderer/features/agents/stores/message-store"
import { useStreamingStatusStore } from "../src/renderer/features/agents/stores/streaming-status-store"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const EmptyComponent = (() => null) as ComponentType<any>
const measuredGroupHeights = new Map<number, number>()

class MeasuredResizeObserver implements ResizeObserver {
  private disconnected = false

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    requestAnimationFrame(() => {
      if (this.disconnected || !target.isConnected) return
      const index = Number((target as HTMLElement).dataset.index)
      const height = target.hasAttribute("data-index")
        ? (measuredGroupHeights.get(index) ?? 80)
        : 600
      this.callback(
        [
          {
            target,
            borderBoxSize: [{ inlineSize: 800, blockSize: height }],
            contentBoxSize: [{ inlineSize: 800, blockSize: height }],
            devicePixelContentBoxSize: [{ inlineSize: 800, blockSize: height }],
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this,
      )
    })
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true
  }
}

function sectionProps(
  subChatId: string,
  scrollElementRef: RefObject<HTMLElement | null>,
  virtualizerRef?: RefObject<unknown>,
) {
  return {
    subChatId,
    chatId: `chat-${subChatId}`,
    isMobile: false,
    sandboxSetupStatus: "ready" as const,
    stickyTopClass: "top-0",
    UserBubbleComponent: EmptyComponent,
    ToolCallComponent: EmptyComponent,
    MessageGroupWrapper: EmptyComponent,
    toolRegistry: {},
    scrollElementRef,
    virtualizerRef,
  }
}

describe("IsolatedMessagesSection transcript virtualization", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    measuredGroupHeights.clear()
    window.ResizeObserver = MeasuredResizeObserver
    globalThis.ResizeObserver = MeasuredResizeObserver
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    Object.defineProperties(HTMLElement.prototype, {
      clientHeight: { configurable: true, get: () => 600 },
      clientWidth: { configurable: true, get: () => 800 },
      offsetHeight: { configurable: true, get: () => 600 },
      offsetWidth: { configurable: true, get: () => 800 },
      scrollHeight: {
        configurable: true,
        get() {
          const ownHeight = Number.parseFloat((this as HTMLElement).style.height)
          const virtualHeight = Number.parseFloat(
            (this as HTMLElement).querySelector<HTMLElement>("[data-total-message-groups]")?.style
              .height ?? "",
          )
          return Math.max(
            Number.isFinite(ownHeight) ? ownHeight : 600,
            Number.isFinite(virtualHeight) ? virtualHeight : 600,
          )
        },
      },
    })
    HTMLElement.prototype.scrollTo = function scrollTo(
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0)
      this.scrollTop = top
      this.dispatchEvent(new Event("scroll"))
    }
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const index = Number((this as HTMLElement).dataset.index)
      const height = this.hasAttribute("data-index") ? (measuredGroupHeights.get(index) ?? 80) : 600
      const top = this.hasAttribute("data-total-message-groups")
        ? -(this.parentElement?.scrollTop ?? 0)
        : 0
      return {
        x: 0,
        y: top,
        top,
        right: 800,
        bottom: top + height,
        left: 0,
        width: 800,
        height,
        toJSON: () => ({}),
      }
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    useStreamingStatusStore.setState({ statuses: {} })
    container.remove()
  })

  it("captures the naturally visible keyed group and its measured viewport offset", () => {
    expect(
      findVisibleTranscriptAnchor(
        [
          { key: "user-a", start: 0 },
          { key: "user-b", start: 170 },
          { key: "user-c", start: 430 },
        ],
        215,
      ),
    ).toEqual({ key: "user-b", viewportOffset: -45 })
  })

  it("keeps the mounted DOM bounded for a 100k-message transcript without discarding IDs", async () => {
    const subChatId = "large-chat"
    const userMessageIds = Array.from({ length: 50_000 }, (_, index) => `user-${index}`)
    appStore.set(userMessageIdsPerChatAtom(subChatId), userMessageIds)
    const scrollElementRef = createRef<HTMLElement>()

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(
            "div",
            {
              ref: scrollElementRef,
              "data-chat-container": true,
              style: { height: "600px", overflowY: "auto" },
            },
            createElement(IsolatedMessagesSection as ComponentType<any>, {
              ...sectionProps(subChatId, scrollElementRef),
            }),
          ),
        ),
      ),
    )

    expect(container.querySelectorAll("[data-rendered-group]").length).toBeLessThan(100)
    expect(
      container
        .querySelector("[data-total-message-groups]")
        ?.getAttribute("data-total-message-groups"),
    ).toBe("50000")
    expect(appStore.get(userMessageIdsPerChatAtom(subChatId))).toEqual(userMessageIds)
  })

  it("measures variable-height groups instead of assuming fixed rows", async () => {
    const subChatId = "variable-height-chat"
    const userMessageIds = Array.from({ length: 20 }, (_, index) => `user-${index}`)
    measuredGroupHeights.set(0, 80)
    measuredGroupHeights.set(1, 160)
    measuredGroupHeights.set(2, 120)
    appStore.set(userMessageIdsPerChatAtom(subChatId), userMessageIds)
    const scrollElementRef = createRef<HTMLElement>()

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(
            "div",
            {
              ref: scrollElementRef,
              "data-chat-container": true,
              style: { height: "600px", overflowY: "auto" },
            },
            createElement(IsolatedMessagesSection as ComponentType<any>, {
              ...sectionProps(subChatId, scrollElementRef),
            }),
          ),
        ),
      ),
    )
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    const startForIndex = (index: number) => {
      const style = container.querySelector<HTMLElement>(`[data-index="${index}"]`)?.style
      return Number.parseFloat(style?.top || style?.transform.match(/-?\d+(?:\.\d+)?/)?.[0] || "")
    }
    expect(startForIndex(1) - startForIndex(0)).toBe(80)
    expect(startForIndex(2) - startForIndex(1)).toBe(160)
  })

  it("mounts an offscreen assistant result by scrolling its owning user group", async () => {
    const subChatId = "search-chat"
    const userMessageIds = Array.from({ length: 1_000 }, (_, index) => `user-${index}`)
    appStore.set(userMessageIdsPerChatAtom(subChatId), userMessageIds)
    appStore.set(
      messageGroupsPerChatAtom(subChatId),
      userMessageIds.map((userMsgId, index) => ({
        userMsgId,
        assistantMsgIds: [`assistant-${index}`],
      })),
    )
    const scrollElementRef = createRef<HTMLElement>()
    const virtualizerRef = createRef<any>()

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(
            "div",
            {
              ref: scrollElementRef,
              "data-chat-container": true,
              style: { height: "600px", overflowY: "auto" },
            },
            createElement(IsolatedMessagesSection as ComponentType<any>, {
              ...sectionProps(subChatId, scrollElementRef, virtualizerRef),
            }),
          ),
        ),
      ),
    )

    expect(container.querySelector('[data-rendered-group="user-900"]')).toBeNull()
    expect(container.querySelectorAll("[data-rendered-group]").length).toBeGreaterThan(0)
    expect(container.querySelector("[data-virtualization-ready]")).not.toBeNull()
    await act(async () => {
      expect(virtualizerRef.current.scrollToMessage("assistant-900", { focus: true })).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    expect(scrollElementRef.current!.scrollTop).toBeGreaterThan(0)
    expect(container.querySelector('[data-rendered-group="user-900"]')).not.toBeNull()
    expect((document.activeElement as HTMLElement).dataset.assistantMessageId).toBe("assistant-900")
    expect(container.querySelectorAll("[data-rendered-group]").length).toBeLessThan(100)
  })

  it("keeps four virtualized panes isolated while one pane jumps offscreen", async () => {
    const paneIds = ["pane-a", "pane-b", "pane-c", "pane-d"]
    const scrollRefs = paneIds.map(() => createRef<HTMLElement>())
    const virtualizerRefs = paneIds.map(() => createRef<any>())
    for (const paneId of paneIds) {
      const ids = Array.from({ length: 1_000 }, (_, index) => `${paneId}-user-${index}`)
      appStore.set(userMessageIdsPerChatAtom(paneId), ids)
      appStore.set(
        messageGroupsPerChatAtom(paneId),
        ids.map((userMsgId, index) => ({
          userMsgId,
          assistantMsgIds: [`${paneId}-assistant-${index}`],
        })),
      )
    }

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          ...paneIds.map((paneId, index) =>
            createElement(
              "div",
              {
                key: paneId,
                ref: scrollRefs[index],
                "data-pane": paneId,
                "data-chat-container": true,
                style: { height: "600px", overflowY: "auto" },
              },
              createElement(IsolatedMessagesSection as ComponentType<any>, {
                ...sectionProps(paneId, scrollRefs[index], virtualizerRefs[index]),
              }),
            ),
          ),
        ),
      ),
    )

    await act(async () => {
      expect(virtualizerRefs[1].current.scrollToMessage("pane-b-assistant-900")).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 250))
    })

    expect(
      container.querySelector('[data-pane="pane-b"] [data-rendered-group="pane-b-user-900"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-pane="pane-a"] [data-rendered-group="pane-b-user-900"]'),
    ).toBeNull()
    for (const paneId of paneIds) {
      const pane = container.querySelector(`[data-pane="${paneId}"]`)!
      expect(pane.querySelectorAll("[data-rendered-group]").length).toBeLessThan(100)
      expect(
        [...pane.querySelectorAll("[data-rendered-sub-chat]")].every(
          (element) => element.getAttribute("data-rendered-sub-chat") === paneId,
        ),
      ).toBe(true)
    }
  })

  it("keeps the live streaming tail mounted as a new group arrives", async () => {
    const subChatId = "streaming-chat"
    const initialIds = Array.from({ length: 1_000 }, (_, index) => `user-${index}`)
    appStore.set(userMessageIdsPerChatAtom(subChatId), initialIds)
    appStore.set(
      messageGroupsPerChatAtom(subChatId),
      initialIds.map((userMsgId, index) => ({
        userMsgId,
        assistantMsgIds: [`assistant-${index}`],
      })),
    )
    useStreamingStatusStore.getState().setStatus(subChatId, "streaming")
    const scrollElementRef = createRef<HTMLElement>()

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(
            "div",
            {
              ref: scrollElementRef,
              "data-chat-container": true,
              style: { height: "600px", overflowY: "auto" },
            },
            createElement(IsolatedMessagesSection as ComponentType<any>, {
              ...sectionProps(subChatId, scrollElementRef),
            }),
          ),
        ),
      ),
    )
    expect(container.querySelector('[data-rendered-group="user-999"]')).not.toBeNull()

    const nextIds = [...initialIds, "user-1000"]
    await act(async () => {
      appStore.set(userMessageIdsPerChatAtom(subChatId), nextIds)
      appStore.set(messageGroupsPerChatAtom(subChatId), [
        ...initialIds.map((userMsgId, index) => ({
          userMsgId,
          assistantMsgIds: [`assistant-${index}`],
        })),
        { userMsgId: "user-1000", assistantMsgIds: ["assistant-1000"] },
      ])
    })

    expect(container.querySelector('[data-rendered-group="user-1000"]')).not.toBeNull()
    expect(container.querySelectorAll("[data-rendered-group]").length).toBeLessThan(100)
    expect(appStore.get(userMessageIdsPerChatAtom(subChatId))).toHaveLength(1_001)
  })

  it("fails closed without an owning scroll element while retaining transcript truth", async () => {
    const subChatId = "detached-chat"
    const ids = Array.from({ length: 1_000 }, (_, index) => `user-${index}`)
    appStore.set(userMessageIdsPerChatAtom(subChatId), ids)
    appStore.set(
      messageGroupsPerChatAtom(subChatId),
      ids.map((userMsgId, index) => ({
        userMsgId,
        assistantMsgIds: [`assistant-${index}`],
      })),
    )

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(IsolatedMessagesSection as ComponentType<any>, {
            ...sectionProps(subChatId, createRef<HTMLElement>()),
            scrollElementRef: undefined,
          }),
        ),
      ),
    )

    expect(container.querySelectorAll("[data-rendered-group]")).toHaveLength(0)
    expect(container.querySelector("[data-virtualization-ready]")).toBeNull()
    expect(
      container
        .querySelector("[data-total-message-groups]")
        ?.getAttribute("data-total-message-groups"),
    ).toBe("1000")
    expect(appStore.get(userMessageIdsPerChatAtom(subChatId))).toHaveLength(1_000)
  })

  it("preserves the visible keyed group when older variable-height groups are prepended", async () => {
    const subChatId = "prepend-chat"
    const initialIds = Array.from({ length: 300 }, (_, index) => `user-${index}`)
    const groups = (ids: string[]) =>
      ids.map((userMsgId) => ({
        userMsgId,
        assistantMsgIds: [userMsgId.replace(/^user-/, "assistant-")],
      }))
    appStore.set(userMessageIdsPerChatAtom(subChatId), initialIds)
    appStore.set(messageGroupsPerChatAtom(subChatId), groups(initialIds))
    const scrollElementRef = createRef<HTMLElement>()
    const virtualizerRef = createRef<any>()

    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store: appStore },
          createElement(
            "div",
            {
              ref: scrollElementRef,
              "data-chat-container": true,
              style: { height: "600px", overflowY: "auto" },
            },
            createElement(IsolatedMessagesSection as ComponentType<any>, {
              ...sectionProps(subChatId, scrollElementRef, virtualizerRef),
            }),
          ),
        ),
      ),
    )
    await act(async () => {
      expect(virtualizerRef.current.scrollToMessage("user-200")).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    expect(container.querySelector('[data-rendered-group="user-200"]')).not.toBeNull()
    const renderedItems = () =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-virtual-message-group]")).map(
        (element) => ({
          key: element.dataset.virtualMessageGroup!,
          start: Number.parseFloat(
            element.style.top || element.style.transform.match(/-?\d+(?:\.\d+)?/)?.[0] || "NaN",
          ),
        }),
      )
    const anchorBeforePrepend = findVisibleTranscriptAnchor(
      renderedItems(),
      scrollElementRef.current!.scrollTop,
    )
    expect(anchorBeforePrepend).not.toBeNull()

    const prependedIds = Array.from({ length: 50 }, (_, index) => `older-${index}`)
    const nextIds = [...prependedIds, ...initialIds]
    await act(async () => {
      appStore.set(userMessageIdsPerChatAtom(subChatId), nextIds)
      appStore.set(messageGroupsPerChatAtom(subChatId), groups(nextIds))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })

    await vi.waitFor(() => {
      const anchorAfterPrepend = renderedItems().find(
        (item) => item.key === anchorBeforePrepend!.key,
      )
      expect(anchorAfterPrepend).toBeDefined()
      expect(
        Math.abs(
          anchorAfterPrepend!.start -
            scrollElementRef.current!.scrollTop -
            anchorBeforePrepend!.viewportOffset,
        ),
      ).toBeLessThanOrEqual(1)
      expect(container.querySelector('[data-rendered-group="user-200"]')).not.toBeNull()
    })
    expect(container.querySelectorAll("[data-rendered-group]").length).toBeLessThan(100)
  })
})
