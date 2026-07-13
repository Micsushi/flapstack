// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentInputDialog } from "../src/renderer/features/agents/ui/agent-input-dialog"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

const baseRequest = {
  subChatId: "chat-1",
  parentChatId: "parent-1",
  toolUseId: "request-1",
  questions: [
    {
      question: "Choose one",
      header: "Single choice",
      options: [
        { label: "Alpha", description: "First" },
        { label: "Beta", description: "Second" },
      ],
      multiSelect: false,
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
    expect(callbacks.onAnswer).toHaveBeenCalledWith({ "Choose one": "Other: Gamma" })
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
})
