// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  OrchestrationFleetItemDto,
  OrchestrationFleetPageDto,
} from "../src/shared/agent-orchestration"
import {
  OrchestrationFleetPanel,
  type OrchestrationFleetFilters,
} from "../src/renderer/features/orchestration-fleet/orchestration-fleet-view"

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      orchestrationOperations: { listActivity: { invalidate: vi.fn() } },
    }),
    orchestrationOperations: {
      listActivity: {
        useQuery: () => ({ isLoading: false, error: null, data: [] }),
      },
      rebuildActivity: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
    },
  },
}))

const filters: OrchestrationFleetFilters = {
  projectId: "",
  taskId: "",
  status: "",
  provider: "",
  state: "all",
  archiveScope: "visible",
  sort: "updated-desc",
}

const first = item({ taskId: "task-1", taskName: "Build fleet", provider: "codex" })
const second = item({
  taskId: "task-2",
  taskName: "Review fleet",
  provider: "anthropic",
  freshness: "stale",
  initiatingChatState: "missing",
})
const page: OrchestrationFleetPageDto = {
  items: [first, second],
  total: 2,
  nextCursor: "next",
  observedAt: 2_000,
  facets: {
    projects: [{ id: "project-1", label: "Flapstack", count: 2 }],
    tasks: [
      { id: "task-1", label: "Build fleet", count: 1 },
      { id: "task-2", label: "Review fleet", count: 1 },
    ],
    statuses: [{ id: "running", label: "running", count: 2 }],
    providers: [
      { id: "anthropic", label: "anthropic", count: 1 },
      { id: "codex", label: "codex", count: 1 },
    ],
  },
}

describe("orchestration fleet view", () => {
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
  })

  it("renders visible provider/state detail and keyboard-focusable rows", async () => {
    const openChat = vi.fn()
    const openWorkspace = vi.fn()
    await act(async () => {
      root.render(
        <OrchestrationFleetPanel
          {...props({ data: page, onOpenChat: openChat, onOpenWorkspace: openWorkspace })}
        />,
      )
    })

    expect(container.querySelector("h1")?.textContent).toBe("Orchestration fleet")
    expect(container.querySelectorAll("select")).toHaveLength(7)
    expect(container.textContent).toContain("codex")
    expect(container.textContent).toContain("Workflow")
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Showing 2 of 2")

    const rows = [...container.querySelectorAll<HTMLButtonElement>("[data-fleet-row]")]
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1])
    rows[0]!.focus()
    await act(async () => {
      rows[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    })
    expect(document.activeElement).toBe(rows[1])
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0])
    expect(container.querySelector("aside h2")?.textContent).toBe("Review fleet")
    expect(container.textContent).toContain("No durable state change within 30 seconds.")
    const initiating = [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (button) => button.textContent?.includes("Initiating chat"),
    )
    expect(initiating?.disabled).toBe(true)

    await act(async () => rows[0]!.click())
    const workspace = [...container.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (button) => button.textContent?.includes("Open operation workspace"),
    )
    await act(async () => workspace!.click())
    expect(openWorkspace).toHaveBeenCalledWith("project-1", "workspace-task-1")
    const agentChat = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open agent chat Worker"]',
    )
    expect(agentChat).not.toBeNull()
    await act(async () => agentChat!.click())
    expect(openChat).toHaveBeenCalledWith("chat-agent-task-1")

    const mixed = {
      ...first,
      aggregate: {
        ...first.aggregate,
        exactCostUsdMicros: 1_000_000,
        providerReportedCostUsdMicros: 500_000,
        estimatedCostUsdMicros: 250_000,
        costQuality: "unknown" as const,
      },
    }
    await act(async () => {
      root.render(
        <OrchestrationFleetPanel {...props({ data: { ...page, items: [mixed], total: 1 } })} />,
      )
    })
    expect(container.textContent).toContain(
      "$1.00 exact + $0.50 reported + $0.25 estimated; unknown values included",
    )
  })

  it("exposes labeled filters and updates without submitting", async () => {
    const onFiltersChange = vi.fn()
    await act(async () => {
      root.render(<OrchestrationFleetPanel {...props({ data: page, onFiltersChange })} />)
    })
    const provider = container.querySelector<HTMLSelectElement>("#fleet-provider")!
    provider.value = "anthropic"
    provider.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, provider: "anthropic" })
    expect(container.querySelector('form[aria-label="Fleet filters"]')).not.toBeNull()
    expect(container.querySelector('nav[aria-label="Fleet pagination"]')).not.toBeNull()
  })

  it("announces loading, empty, and error states with retry", async () => {
    const retry = vi.fn()
    await act(async () => {
      root.render(<OrchestrationFleetPanel {...props({ isLoading: true })} />)
    })
    expect(container.textContent).toContain("Loading orchestration fleet")

    await act(async () => {
      root.render(
        <OrchestrationFleetPanel {...props({ data: { ...page, items: [], total: 0 } })} />,
      )
    })
    expect(container.textContent).toContain("No orchestrations match these filters")

    await act(async () => {
      root.render(
        <OrchestrationFleetPanel {...props({ error: "database unavailable", onRetry: retry })} />,
      )
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("database unavailable")
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    )
    expect(retry).toHaveBeenCalledOnce()
  })
})

function props(overrides: Partial<React.ComponentProps<typeof OrchestrationFleetPanel>> = {}) {
  return {
    data: undefined,
    filters,
    isLoading: false,
    isFetching: false,
    error: null,
    canPrevious: false,
    onFiltersChange: vi.fn(),
    onRefresh: vi.fn(),
    onRetry: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenWorkspace: vi.fn(),
    ...overrides,
  }
}

function item(input: {
  taskId: string
  taskName: string
  provider: string
  freshness?: OrchestrationFleetItemDto["freshness"]
  initiatingChatState?: OrchestrationFleetItemDto["initiatingChat"]["state"]
}): OrchestrationFleetItemDto {
  return {
    taskId: input.taskId,
    taskName: input.taskName,
    taskArchived: false,
    projectId: "project-1",
    projectName: "Flapstack",
    projectArchived: false,
    status: "running",
    state: "active",
    freshness: input.freshness ?? "live",
    freshnessReason:
      input.freshness === "stale"
        ? "No durable state change within 30 seconds."
        : "Durable state changed within the live freshness window.",
    createdAt: 1_000,
    updatedAt: 2_000,
    completedAt: null,
    maxParallelAgents: 2,
    maxDepth: 4,
    blockerCount: 0,
    providers: [input.provider],
    harnesses: [input.provider === "anthropic" ? "claude-code" : "codex"],
    aggregate: {
      total: 1,
      queued: 0,
      active: 1,
      completed: 0,
      failed: 0,
      blocked: 0,
      stopped: 0,
      progressPercent: 50,
      totalTokens: 100,
      exactCostUsdMicros: 0,
      providerReportedCostUsdMicros: 0,
      estimatedCostUsdMicros: 0,
      costQuality: "unknown",
    },
    engine: {
      id: "workflow",
      label: "Workflow",
      version: "workflow-v1",
      provenance: "product",
    },
    coordinationIdentity: { kind: "task", label: input.taskName },
    initiatingChat: {
      id: `chat-${input.taskId}`,
      state: input.initiatingChatState ?? "live",
    },
    operationWorkspace: { id: `workspace-${input.taskId}`, state: "live" },
    agents: [
      {
        id: `agent-${input.taskId}`,
        status: "active",
        role: "Worker",
        name: "Worker",
        harness: input.provider === "anthropic" ? "claude-code" : "codex",
        provider: input.provider,
        providerProvenance: "harness",
        progressPercent: 50,
        blockerCount: 0,
        totalTokens: 100,
        costUsdMicros: null,
        costQuality: "unknown",
        chat: { id: `chat-agent-${input.taskId}`, state: "live" },
        run: { id: `run-${input.taskId}`, status: "running" },
      },
    ],
  }
}
