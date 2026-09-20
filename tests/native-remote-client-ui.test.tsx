// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  state: {} as any,
  statusError: null as Error | null,
  answer: vi.fn(),
  pair: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ mobileClient: { status: { invalidate: vi.fn() } } }),
    mobileClient: {
      status: { useQuery: () => ({ data: mocks.state, error: mocks.statusError }) },
      pair: { useMutation: () => ({ mutate: mocks.pair, isPending: false }) },
      connect: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      disconnect: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      answer: { useMutation: () => ({ mutate: mocks.answer, isPending: false }) },
    },
  },
}))
import { RemoteComputerClientSection } from "../src/renderer/components/dialogs/settings-tabs/remote-computer-client"
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("shows exact remote host and requires target confirmation; stale state disables answers", async () => {
  mocks.state = {
    host: { label: "Office", endpoint: "https://100.78.162.80:4317", deviceId: "device1" },
    current: true,
    connectionId: "connection1",
    grantId: "grant1",
    snapshot: {
      scopeVersion: 2,
      items: [
        {
          kind: "agent-input",
          id: "input1",
          version: 3,
          chatId: "chat1",
          runId: "run1",
          questions: [
            {
              id: "q1",
              question: "Continue?",
              options: ["Yes"],
              multiSelect: false,
              allowCustom: true,
            },
          ],
        },
      ],
    },
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<RemoteComputerClientSection />))
    expect(host.textContent).toContain(
      "https://100.78.162.80:4317 · Chat chat1 · Run run1 · Request input1",
    )
    const send = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Send answer",
    )!
    expect(send.disabled).toBe(true)
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    )
    expect(mocks.answer).not.toHaveBeenCalled()
    await act(async () => (host.querySelector('input[type="radio"]') as HTMLInputElement).click())
    const confirm = [...host.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement
    await act(async () => confirm.click())
    expect(send.disabled).toBe(false)
    await act(async () => send.click())
    expect(mocks.answer).toHaveBeenCalledWith({
      connectionId: "connection1",
      scopeVersion: 2,
      targetId: "input1",
      targetVersion: 3,
      answers: { q1: ["Yes"] },
      confirmed: true,
    })
    const custom = host.querySelector('form input[maxlength="4000"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        custom,
        "Custom choice",
      )
      custom.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect((host.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(false)
    await act(async () => confirm.click())
    await act(async () => send.click())
    expect(mocks.answer).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: { q1: ["Custom choice"] } }),
    )
    await act(async () => (host.querySelector('input[type="radio"]') as HTMLInputElement).click())
    expect(custom.value).toBe("")
    await act(async () => confirm.click())
    await act(async () => send.click())
    expect(mocks.answer).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: { q1: ["Yes"] } }),
    )
    mocks.statusError = new Error("Connection status unavailable")
    await act(async () => root.render(<RemoteComputerClientSection />))
    expect(send.disabled).toBe(true)
    expect(host.textContent).toContain("Offline or stale")
    mocks.statusError = null
    mocks.state = { ...mocks.state, current: false }
    await act(async () => root.render(<RemoteComputerClientSection />))
    expect(send.disabled).toBe(true)
    expect(mocks.pair).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
