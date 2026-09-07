// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { toast } from "sonner"
import {
  usePastedTextFiles,
  type UsePastedTextFilesReturn,
} from "../src/renderer/features/agents/hooks/use-pasted-text-files"

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: { files: { writePastedText: { useMutation: () => ({ mutateAsync }) } } },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
afterEach(() => vi.clearAllMocks())

it("reports attachment write failure without pretending the text was attached", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let state!: UsePastedTextFilesReturn
  function Fixture() {
    state = usePastedTextFiles("chat")
    return null
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mutateAsync.mockRejectedValue(new Error("private contents and path"))
  try {
    await act(async () => root.render(<Fixture />))
    await act(async () => state.addPastedText("private text"))
    expect(state.pastedTexts).toEqual([])
    expect(toast.error).toHaveBeenCalledWith("Could not attach pasted text", {
      description: "The text was not added. Your clipboard is unchanged; try pasting again.",
    })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
