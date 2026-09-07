// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AgentInputDialog,
  useAgentInputDisclosure,
} from "../src/renderer/features/agents/ui/agent-input-dialog"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

const baseRequest = {
  subChatId: "chat-1",
  parentChatId: "parent-1",
  toolUseId: "request-1",
  questions: [
    {
      id: "question-1",
      question: "Choose one",
      header: "Single choice",
      options: [
        { id: "alpha", label: "Alpha", description: "First" },
        { id: "beta", label: "Beta", description: "Second" },
      ],
      multiSelect: false,
      allowCustom: true,
    },
  ],
}

function renderDialog(props: Partial<Parameters<typeof AgentInputDialog>[0]> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  const callbacks = {
    onOpenChange: vi.fn(),
    onAnswer: vi.fn(),
    onSkip: vi.fn(),
    onAnswerInChat: vi.fn(),
  }
  act(() => {
    root!.render(<AgentInputDialog request={baseRequest} open {...callbacks} {...props} />)
  })
  return callbacks
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("AgentInputDialog", () => {
  it("keeps new requests collapsed and preserves composer focus until explicitly opened", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    function View({ requestId, active = true }: { requestId: string; active?: boolean }) {
      const disclosure = useAgentInputDisclosure(requestId, active)
      return (
        <>
          <textarea aria-label="Composer" />
          <button onClick={() => disclosure.setOpen(true)}>Answer questions</button>
          <AgentInputDialog
            request={{ ...baseRequest, toolUseId: requestId }}
            open={disclosure.open}
            onOpenChange={disclosure.setOpen}
            onAnswer={vi.fn()}
            onSkip={vi.fn()}
            onAnswerInChat={vi.fn()}
          />
        </>
      )
    }
    const paint = async () =>
      act(async () => {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      })
    act(() => root!.render(<View requestId="first" />))
    const composer = container.querySelector("textarea")!
    composer.focus()
    await paint()
    expect(container.querySelector('[role="region"]')).toBeNull()
    expect(document.activeElement).toBe(composer)
    act(() => container.querySelector("button")!.click())
    await paint()
    expect(document.activeElement).toBe(container.querySelector('input[type="radio"]'))
    act(() => root!.render(<View requestId="second" />))
    expect(container.querySelector('[role="region"]')).toBeNull()
    act(() => container.querySelector("button")!.click())
    act(() => root!.render(<View requestId="second" active={false} />))
    act(() => root!.render(<View requestId="second" />))
    expect(container.querySelector('[role="region"]')).toBeNull()
  })

  it("uses distinct accessible labels for multiple chat panes", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        <>
          {["first", "second"].map((id) => (
            <AgentInputDialog
              key={id}
              request={{ ...baseRequest, toolUseId: id }}
              open
              onOpenChange={vi.fn()}
              onAnswer={vi.fn()}
              onSkip={vi.fn()}
              onAnswerInChat={vi.fn()}
            />
          ))}
        </>,
      ),
    )
    const labels = [...container.querySelectorAll('[role="region"]')].map((region) =>
      region.getAttribute("aria-labelledby"),
    )
    expect(new Set(labels).size).toBe(2)
    for (const label of labels) expect(document.getElementById(label!)).not.toBeNull()
  })

  it("renders as a docked region instead of an interruptive modal", () => {
    renderDialog()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.querySelector('[role="region"]')).not.toBeNull()
  })

  it("uses radio semantics and makes a custom single answer mutually exclusive", async () => {
    const callbacks = renderDialog()
    const radios = [...document.body.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]
    expect(radios).toHaveLength(2)
    await act(async () => radios[0]!.click())
    expect(radios[0]!.checked).toBe(true)

    const custom = document.body.querySelector("textarea") as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(custom, "Gamma")
      custom.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(radios[0]!.checked).toBe(false)

    const submit = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Submit",
    )!
    await act(async () => submit.click())
    expect(callbacks.onAnswer).toHaveBeenCalledWith({ "question-1": ["Other: Gamma"] })
  })

  it("uses checkbox semantics for multi-select and exposes answer-in-chat", async () => {
    const callbacks = renderDialog({
      request: {
        ...baseRequest,
        questions: [{ ...baseRequest.questions[0], multiSelect: true }],
      },
    })
    const checkboxes = [
      ...document.body.querySelectorAll('input[type="checkbox"]'),
    ] as HTMLInputElement[]
    expect(checkboxes).toHaveLength(2)
    await act(async () => {
      checkboxes[0]!.click()
      checkboxes[1]!.click()
    })
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true)

    const answerInChat = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Answer in chat",
    )!
    await act(async () => answerInChat.click())
    expect(callbacks.onAnswerInChat).toHaveBeenCalledOnce()
  })

  it("does not mount a dialog for a background chat", () => {
    renderDialog({ open: false })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it("focuses custom input when a question has no options", async () => {
    renderDialog({
      request: {
        ...baseRequest,
        questions: [{ ...baseRequest.questions[0], options: [], allowCustom: true }],
      },
    })
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })
    expect(document.activeElement).toBe(document.body.querySelector("textarea"))
  })

  it("keeps duplicate visible question text separate by stable question ID", async () => {
    const callbacks = renderDialog({
      request: {
        ...baseRequest,
        questions: [baseRequest.questions[0], { ...baseRequest.questions[0], id: "question-2" }],
      },
    })
    const firstRadio = document.body.querySelector('input[type="radio"]') as HTMLInputElement
    await act(async () => firstRadio.click())
    const next = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Next"),
    )!
    await act(async () => next.click())
    const secondRadio = document.body.querySelector('input[type="radio"]') as HTMLInputElement
    await act(async () => secondRadio.click())
    const submit = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Submit",
    )!
    await act(async () => submit.click())

    expect(callbacks.onAnswer).toHaveBeenCalledWith({
      "question-1": ["Alpha"],
      "question-2": ["Alpha"],
    })
  })

  it("keeps duplicate option labels separate by stable option ID", async () => {
    renderDialog({
      request: {
        ...baseRequest,
        questions: [
          {
            ...baseRequest.questions[0],
            options: [
              { id: "first", label: "Same", description: "First meaning" },
              { id: "second", label: "Same", description: "Second meaning" },
            ],
          },
        ],
      },
    })
    const radios = [...document.body.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]
    await act(async () => radios[0]!.click())
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
  })
})
