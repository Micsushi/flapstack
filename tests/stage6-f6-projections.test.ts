import { describe, expect, it } from "vitest"
import {
  createAdvancedWorkbenchProjection,
  type WorkbenchProjectionActivity,
} from "../src/shared/workbench-projections"
import type { SavedWorkspaceOperationProjection } from "../src/shared/saved-workspaces"

function operation(agentCount: number): SavedWorkspaceOperationProjection {
  return {
    workspaceId: "workspace-1",
    orchestrationId: "orchestration-1",
    taskId: "task-1",
    taskName: "Stage 6",
    projectId: "project-1",
    initiatingChatId: "chat-lead",
    initiatingChatName: "Lead",
    status: "running",
    roster: [],
    agents: Array.from({ length: agentCount }, (_, index) => ({
      agentId: `agent-${String(index).padStart(3, "0")}`,
      chatId: `chat-${index}`,
      chatName: `Agent ${index}`,
      chatState: "ready" as const,
      runId: `run-${index}`,
      parentAgentId: index === 0 ? null : "agent-000",
      replacedAgentId: null,
      role: "worker",
      name: `Agent ${index}`,
      harness: "codex",
      status: index === 3 ? "uncertain" : "running",
      progressPercent: index,
      resultSummary: null,
      stopReason: null,
      blockerCount: 0,
      queuedAt: index,
      startedAt: index,
      completedAt: null,
    })),
    materializedAgentCount: agentCount,
    pendingAgentCount: 0,
    overflowChatCount: 0,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
  }
}

describe("Stage 6 bounded advanced workbench projections", () => {
  it("orders, deduplicates, and caps authoritative fleet/lineage at 100 agents", () => {
    const input = operation(105)
    input.agents.push({ ...input.agents[0], name: "duplicate must not win" })
    const projected = createAdvancedWorkbenchProjection(input, [], [])

    expect(projected.fleet).toHaveLength(100)
    expect(projected.fleet[0]).toMatchObject({ agentId: "agent-000", name: "Agent 0" })
    expect(projected.fleet[99]).toMatchObject({ agentId: "agent-099" })
    expect(projected.truncatedAgentCount).toBe(5)
    expect(projected.lineage.every((edge) => edge.parentAgentId === "agent-000")).toBe(true)
  })

  it("preserves uncertain restart truth and never projects private reasoning or replay state", () => {
    const activity: WorkbenchProjectionActivity[] = [
      {
        id: "event-b",
        sequence: 2,
        occurredAt: 20,
        agentId: "agent-003",
        kind: "warning",
        summary: "Runtime state uncertain after restart",
      },
      {
        id: "event-a",
        sequence: 1,
        occurredAt: 10,
        agentId: "agent-003",
        kind: "checkpoint",
        summary: "Last durable checkpoint",
      },
      {
        id: "event-a",
        sequence: 99,
        occurredAt: 99,
        agentId: "agent-003",
        kind: "private-reasoning",
        summary: "must not replace exact event",
      },
    ]
    const projected = createAdvancedWorkbenchProjection(operation(5), activity, [
      { agentId: "agent-003", canonicalPath: "/root/f6/tg07" },
    ])

    expect(projected.fleet.find((agent) => agent.agentId === "agent-003")).toMatchObject({
      status: "uncertain",
      canReplay: false,
    })
    expect(projected.activity.map((event) => event.id)).toEqual(["event-a", "event-b"])
    expect(JSON.stringify(projected)).not.toMatch(
      /private-reasoning|reasoningContent|providerReplay/,
    )
    expect(projected.taskPaths).toEqual([{ agentId: "agent-003", canonicalPath: "/root/f6/tg07" }])
  })
})
