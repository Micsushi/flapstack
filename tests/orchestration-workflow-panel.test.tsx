// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OrchestrationWorkflowPanel } from "../src/renderer/features/agents/ui/orchestration-workflow-panel"

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  advance: vi.fn(),
  control: vi.fn(),
  gate: vi.fn(),
  retry: vi.fn(),
}))

vi.mock("../src/renderer/lib/trpc", () => {
  const mutation = (mutate: ReturnType<typeof vi.fn>) => ({ isPending: false, mutate })
  const invalidate = vi.fn(async () => undefined)
  return {
    trpc: {
      useUtils: () => ({
        orchestrationOperations: { listWorkflows: { invalidate } },
        spawnedAgents: {
          getTaskOverview: { invalidate },
          getLineage: { invalidate },
        },
      }),
      orchestrationOperations: {
        listTemplates: {
          useQuery: () => ({ data: [{ id: "template-1", name: "Review", version: 2 }] }),
        },
        listWorkflows: {
          useQuery: () => ({
            data: [
              {
                id: "workflow-1",
                status: "waiting",
                definition: {
                  engine: "workflow",
                  workflow: {
                    steps: [
                      { id: "approval", kind: "human-gate" },
                      { id: "worker", kind: "agent", maxRetries: 1 },
                    ],
                  },
                },
                checkpoints: [
                  { stepId: "approval", status: "waiting", attemptCount: 0, error: null },
                  {
                    stepId: "worker",
                    status: "failed",
                    attemptCount: 1,
                    error: "Schema mismatch",
                  },
                ],
              },
            ],
          }),
        },
        startWorkflow: { useMutation: () => mutation(actions.start) },
        advanceWorkflow: { useMutation: () => mutation(actions.advance) },
        controlWorkflow: { useMutation: () => mutation(actions.control) },
        decideHumanGate: { useMutation: () => mutation(actions.gate) },
        retryWorkflowStep: { useMutation: () => mutation(actions.retry) },
      },
    },
  }
})

describe("orchestration workflow panel", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("exposes inspectable workflow checkpoints and exact accessible actions", async () => {
    await act(async () => root.render(<OrchestrationWorkflowPanel taskId="task-1" />))

    expect(container.querySelector('[aria-label="Workflow operations"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Workflow runs"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Checkpoints for workflow-1"]')).not.toBeNull()
    expect(container.textContent).toContain("Review · v2")
    expect(container.textContent).toContain("Schema mismatch")
    expect(container.querySelector('[role="status"]')?.textContent).toBe("waiting")

    const click = (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector)
      expect(button).not.toBeNull()
      act(() => button!.click())
    }
    click('button[aria-label="Start workflow"]')
    click('button[aria-label="Advance workflow workflow-1"]')
    click('button[aria-label="Pause workflow workflow-1"]')
    click('button[aria-label="Stop workflow workflow-1"]')
    click('button[aria-label="Approve human gate approval"]')
    click('button[aria-label="Deny human gate approval"]')
    click('button[aria-label="Retry workflow step worker"]')

    expect(actions.start).toHaveBeenCalledWith({ taskId: "task-1", templateId: "template-1" })
    expect(actions.advance).toHaveBeenCalledWith({ runId: "workflow-1", launches: {} })
    expect(actions.control).toHaveBeenNthCalledWith(1, {
      runId: "workflow-1",
      action: "pause",
    })
    expect(actions.control).toHaveBeenNthCalledWith(2, {
      runId: "workflow-1",
      action: "stop",
    })
    expect(actions.gate).toHaveBeenNthCalledWith(1, {
      runId: "workflow-1",
      stepId: "approval",
      decision: "approve",
    })
    expect(actions.gate).toHaveBeenNthCalledWith(2, {
      runId: "workflow-1",
      stepId: "approval",
      decision: "deny",
    })
    expect(actions.retry).toHaveBeenCalledWith({ runId: "workflow-1", stepId: "worker" })
  })
})
