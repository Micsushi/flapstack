// @vitest-environment jsdom

import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useFocusInputOnEnter } from "../src/renderer/features/agents/hooks/use-focus-input-on-enter"
import { RuntimeActivityTimeline } from "../src/renderer/features/agents/runtime-activity"
import type { AgentActivityEvent } from "../src/shared/agent-activity"
import { activity } from "./runtime-activity-test-helpers"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function RuntimeFocusHarness({ events }: { events: AgentActivityEvent[] }) {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useFocusInputOnEnter(composerRef)
  return (
    <>
      <RuntimeActivityTimeline
        events={events}
        status="ready"
        estimatedRowHeight={48}
        viewportHeight={96}
      />
      <button type="button">Unrelated action</button>
      <textarea ref={composerRef} aria-label="Message composer" />
    </>
  )
}

describe("Runtime activity DOM focus", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("keeps actual row focus through Enter and Space expansion", async () => {
    await render(runtimeEvents(3))
    const rows = activityRows()
    await focus(rows[1])

    await press(rows[1], "Enter")
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1].querySelector("button")?.getAttribute("aria-expanded")).toBe("true")

    await press(rows[1], " ")
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1].querySelector("button")?.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).not.toBe(composer())
  })

  it("keeps roving focus correct across arrows, Home, End, and virtualization", async () => {
    await render(runtimeEvents(30))
    let row = activityRows()[0]
    await focus(row)

    await press(row, "End")
    row = focusedActivityRow()
    expect(row.dataset.runtimeActivityKey).toBe("event:event-30")

    await press(row, "Home")
    row = focusedActivityRow()
    expect(row.dataset.runtimeActivityKey).toBe("event:event-1")

    await press(row, "ArrowDown")
    expect(focusedActivityRow().dataset.runtimeActivityKey).toBe("event:event-2")
    await press(focusedActivityRow(), "ArrowUp")
    expect(focusedActivityRow().dataset.runtimeActivityKey).toBe("event:event-1")
    expect(document.activeElement).not.toBe(composer())
  })

  it("moves focus to the nearest surviving row after a focused row is removed", async () => {
    const events = runtimeEvents(3)
    await render(events)
    const first = activityRows()[0]
    await focus(first)
    await press(first, "ArrowDown")
    expect(focusedActivityRow().dataset.runtimeActivityKey).toBe("event:event-2")

    await render([events[0], events[2]])
    expect(focusedActivityRow().dataset.runtimeActivityKey).toBe("event:event-3")

    await focus(composer())
    await render([events[0]])
    expect(document.activeElement).toBe(composer())
  })

  it("does not steal focus while search filters or native controls handle Enter", async () => {
    await render(runtimeEvents(3))
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search Runtime activity"]',
    )!
    await focus(search)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "activity 3",
      )
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(document.activeElement).toBe(search)
    expect(activityRows()).toHaveLength(1)

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Unrelated action",
    )!
    await focus(button)
    await press(button, "Enter")
    expect(document.activeElement).toBe(button)
  })

  async function render(events: AgentActivityEvent[]) {
    await act(async () => root.render(<RuntimeFocusHarness events={events} />))
  }

  function activityRows(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-runtime-activity-key]"))
  }

  function focusedActivityRow(): HTMLElement {
    const row = document.activeElement as HTMLElement
    expect(row.dataset.runtimeActivityKey).toBeTruthy()
    return row
  }

  function composer(): HTMLTextAreaElement {
    return container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message composer"]')!
  }
})

async function press(target: Element, key: string): Promise<void> {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  )
}

async function focus(target: HTMLElement): Promise<void> {
  await act(async () => target.focus())
}

function runtimeEvents(count: number): AgentActivityEvent[] {
  return Array.from({ length: count }, (_, index) =>
    activity(
      "warning",
      { message: `activity ${index + 1}`, code: null },
      { storageId: index + 1, sequence: index + 1, eventId: `event-${index + 1}` },
    ),
  )
}
