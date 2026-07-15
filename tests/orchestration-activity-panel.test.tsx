// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    orchestrationOperations: {
      listActivity: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: [
            {
              id: "event-1",
              taskId: "task-1",
              agentId: "agent-1",
              runId: "run-1",
              runtime: "codex",
              sourceActivityEventId: "runtime-event-1",
              kind: "aggregate-status",
              phase: "running",
              summary: null,
              createdAt: 1,
            },
          ],
        }),
      },
    },
  },
}))

import { OrchestrationActivityPanel } from "../src/renderer/features/agents/ui/orchestration-activity-panel"

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

describe("orchestration activity panel", () => {
  it("renders accessible filters and reference-only runtime provenance", async () => {
    container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <OrchestrationActivityPanel
          taskId="task-1"
          agents={[
            {
              id: "agent-1",
              runId: "run-1",
              definition: { role: "Reviewer" },
            },
          ]}
        />,
      ),
    )
    expect(container.querySelectorAll("select")).toHaveLength(4)
    expect(container.textContent).toContain("Runtime activity remains authoritative")
    expect(container.textContent).toContain("activity ref runtime-event-1")
    expect(container.textContent).toContain("runtime codex")
    expect(
      container.querySelector('button[aria-label="Rebuild group activity projection"]'),
    ).toBeNull()
  })
})
