// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  OrchestrationLineageDto,
  OrchestrationTaskOverviewDto,
} from "../src/shared/agent-orchestration"
import {
  applyOrchestrationPermissionMode,
  ChatForkLineageLinks,
  formatOrchestrationCost,
  getLineageNavigation,
  OrchestrationOverviewCard,
} from "../src/renderer/features/agents/ui/orchestration-task-card"
import { readRendererOrchestrationCard } from "../src/renderer/features/agents/lib/orchestration-test-state"

vi.mock("../src/renderer/lib/trpc", () => ({ trpc: {} }))

const definition = {
  role: "Implementer",
  name: "UI worker",
  prompt: "Build the UI",
  harness: "codex" as const,
  permissionMode: "ask-before-edits" as const,
  worktreeStrategy: "task-primary" as const,
  dependencyAgentIds: [],
  completionCriteria: "Tests pass",
}

const overview: OrchestrationTaskOverviewDto = {
  orchestration: {
    taskId: "task-1",
    projectId: "project-1",
    name: "Finish Stage 4",
    initiatingChatId: "chat-parent",
    status: "running",
    maxParallelAgents: 2,
    maxDepth: 4,
    stopConditions: { maxFailures: 2 },
    stopReason: null,
    createdAt: 1,
    startedAt: 2,
    completedAt: null,
  },
  aggregate: {
    total: 2,
    queued: 1,
    active: 1,
    completed: 0,
    failed: 0,
    blocked: 0,
    stopped: 0,
    progressPercent: 25,
    totalTokens: 1_234,
    exactCostUsdMicros: 0,
    providerReportedCostUsdMicros: 0,
    estimatedCostUsdMicros: 125_000,
    costQuality: "estimated",
  },
  agents: [
    {
      id: "agent-1",
      taskId: "task-1",
      chatId: "chat-child",
      runId: "run-1",
      parentAgentId: null,
      replacedAgentId: null,
      depth: 1,
      status: "active",
      progressPercent: 50,
      definition,
      inputTokens: 600,
      outputTokens: 200,
      reasoningTokens: 100,
      totalTokens: 900,
      costUsdMicros: 125_000,
      costQuality: "estimated",
      resultSummary: null,
      stopReason: null,
      blockerCount: 0,
      queuedAt: 2,
      startedAt: 3,
      completedAt: null,
    },
    {
      id: "agent-2",
      taskId: "task-1",
      chatId: null,
      runId: null,
      parentAgentId: "agent-1",
      replacedAgentId: null,
      depth: 2,
      status: "queued",
      progressPercent: 0,
      definition: { ...definition, role: "Reviewer", name: "Review worker" },
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsdMicros: null,
      costQuality: "unknown",
      resultSummary: null,
      stopReason: null,
      blockerCount: 0,
      queuedAt: 4,
      startedAt: null,
      completedAt: null,
    },
  ],
}

const lineage: OrchestrationLineageDto = {
  taskId: "task-1",
  nodes: overview.agents.map((agent) => ({
    agentId: agent.id,
    chatId: agent.chatId,
    parentAgentId: agent.parentAgentId,
    replacedAgentId: agent.replacedAgentId,
    role: agent.definition.role,
    name: agent.definition.name ?? agent.definition.role,
    status: agent.status,
  })),
  edges: [{ fromAgentId: "agent-1", toAgentId: "agent-2", kind: "spawned" }],
}

describe("orchestration task card", () => {
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

  it("labels estimated and provider-reported cost honestly", () => {
    expect(formatOrchestrationCost(0, 0, 125_000, "estimated")).toBe("est. $0.13")
    expect(formatOrchestrationCost(0, 125_000, 0, "provider-reported")).toBe("$0.13 reported")
    expect(formatOrchestrationCost(100_000, 50_000, 30_000, "exact")).toBe(
      "$0.10 exact + $0.05 reported + est. $0.03",
    )
    expect(formatOrchestrationCost(0, 0, 0, "unknown")).toBeNull()
  })

  it("exposes a bounded renderer snapshot for authenticated MCP proof", async () => {
    await act(async () => {
      root.render(
        <OrchestrationOverviewCard
          overview={overview}
          lineage={lineage}
          currentChatId="chat-parent"
          onNavigate={() => undefined}
          onControl={() => undefined}
          onRetry={() => undefined}
          onReplace={() => undefined}
          onAdd={() => undefined}
        />,
      )
    })

    expect(readRendererOrchestrationCard(container, "task-1", "chat-parent")).toMatchObject({
      taskId: "task-1",
      chatId: "chat-parent",
      accessibleName: "Agent orchestration Finish Stage 4",
      status: "running",
      costQuality: "estimated",
      lineageLabels: ["Open child agent chat UI worker", "Open agent chat UI worker"],
      agentStatuses: [
        { agentId: "agent-1", status: "active" },
        { agentId: "agent-2", status: "queued" },
      ],
    })
    expect(readRendererOrchestrationCard(container, "missing-task", "chat-parent")).toBeNull()
    expect(readRendererOrchestrationCard(container, "task-1", "other-chat")).toBeNull()

    container.classList.add("hidden")
    expect(readRendererOrchestrationCard(container, "task-1", "chat-parent")).toBeNull()
  })

  it("creates and clears exact custom permission capabilities", () => {
    const custom = applyOrchestrationPermissionMode(definition, "custom")
    expect(custom.customPermissions).toMatchObject({
      schemaVersion: 1,
      projectWrite: false,
      productMcpTier3: false,
    })
    expect(applyOrchestrationPermissionMode(custom, "read-only").customPermissions).toBeUndefined()
  })

  it("resolves parent and child navigation without losing the initiating chat", () => {
    expect(getLineageNavigation(overview, lineage, "chat-parent")).toEqual({
      parentChatId: null,
      childChats: [{ id: "chat-child", label: "UI worker" }],
    })
    expect(getLineageNavigation(overview, lineage, "chat-child")).toEqual({
      parentChatId: "chat-parent",
      childChats: [],
    })
  })

  it("renders aggregate state and exposes accessible controls", () => {
    const onNavigate = vi.fn()
    const onControl = vi.fn()
    act(() => {
      root.render(
        <OrchestrationOverviewCard
          overview={overview}
          lineage={lineage}
          currentChatId="chat-parent"
          onNavigate={onNavigate}
          onControl={onControl}
          onRetry={vi.fn()}
          onReplace={vi.fn()}
          onAdd={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("Finish Stage 4")
    expect(container.textContent).toContain("1 active")
    expect(container.textContent).toContain("1 queued")
    expect(container.textContent).toContain("est. $0.13")
    expect(container.textContent).toContain("agent-1")
    expect(container.textContent).toContain("agent-2")

    const pause = container.querySelector<HTMLButtonElement>('[aria-label="Pause orchestration"]')
    expect(pause).not.toBeNull()
    act(() => pause!.click())
    expect(onControl).toHaveBeenCalledWith("pause")

    const child = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open child agent chat UI worker"]',
    )
    expect(child).not.toBeNull()
    act(() => child!.click())
    expect(onNavigate).toHaveBeenCalledWith("chat-child")
  })

  it("links both directions for ordinary spawned chats", () => {
    const onNavigate = vi.fn()
    act(() => {
      root.render(
        <ChatForkLineageLinks
          lineage={{
            status: "ok",
            parent: { id: "parent", name: "Initiator", archived: false },
            children: [{ id: "child", name: "Reviewer", archived: false }],
          }}
          onNavigate={onNavigate}
        />,
      )
    })
    const parent = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open parent agent chat Initiator"]',
    )
    const child = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open child agent chat Reviewer"]',
    )
    expect(parent).not.toBeNull()
    expect(child).not.toBeNull()
    act(() => parent!.click())
    act(() => child!.click())
    expect(onNavigate.mock.calls).toEqual([["parent"], ["child"]])
  })
})
