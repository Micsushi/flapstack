// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mountBoard } from "@project-records/board.js"
import { SharedRecordsBoard } from "../src/renderer/features/project-records/shared-records-board"

vi.mock("@project-records/board.js", () => ({
  mountBoard: vi.fn(() => () => undefined),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: { projectRecords: { boardRequest: { mutate: vi.fn() } } },
}))

describe("shared Records workspace route", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("passes canonical Fleet view and opaque navigation refs through mountBoard", async () => {
    await act(async () =>
      root.render(
        <Provider>
          <SharedRecordsBoard initialView="fleet" />
        </Provider>,
      ),
    )
    expect(vi.mocked(mountBoard)).toHaveBeenCalledOnce()
    const firstOptions = vi.mocked(mountBoard).mock.calls[0]![1]!
    expect(firstOptions.view).toBe("fleet")
    expect(firstOptions.embedded).toBe(true)

    await act(async () =>
      firstOptions.onNavigate?.({
        view: "board",
        taskRef: { path: "lanes/vault/tasks.md", recordId: "TASK-42" },
        setupRef: { setupId: "setup-7", version: 2 },
        agentRef: { agentId: "agent-9", runId: "run-9" },
      }),
    )
    expect(vi.mocked(mountBoard)).toHaveBeenCalledOnce()
    // Native route changes consume the saved destination. Local callbacks
    // leave the shared controller mounted so unsaved forms survive navigation.
    await act(async () =>
      root.render(
        <Provider>
          <SharedRecordsBoard />
        </Provider>,
      ),
    )
    expect(vi.mocked(mountBoard).mock.calls.at(-1)?.[1]).toMatchObject({
      view: "board",
      selectedTaskRef: { path: "lanes/vault/tasks.md", recordId: "TASK-42" },
    })
    await act(async () =>
      root.render(
        <Provider>
          <SharedRecordsBoard initialView="fleet" />
        </Provider>,
      ),
    )
    expect(vi.mocked(mountBoard).mock.calls.at(-1)?.[1]?.view).toBe("fleet")
  })
})
