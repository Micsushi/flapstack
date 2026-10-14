import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import {
  OrchestrationFleetPanel,
  type OrchestrationFleetFilters,
} from "../../src/renderer/features/orchestration-fleet/orchestration-fleet-view"
import type { OrchestrationFleetItemDto } from "../../src/shared/agent-orchestration"
import { AutomationsView } from "../../src/renderer/features/automations/automations-view"
import { AutomationCard } from "../../src/renderer/features/automations/_components/automation-card"
import { AgentsBetaTab } from "../../src/renderer/components/dialogs/settings-tabs/agents-beta-tab"
import { ProjectRecordsView } from "../../src/renderer/features/project-records/project-records-view"
import { ProjectVaultView } from "../../src/renderer/features/project-vault/project-vault-view"
import { SavedWorkspacesView } from "../../src/renderer/features/saved-workspaces/saved-workspaces-view"
import { PlanView } from "../../src/renderer/features/plan/plan-view"
import { RepositoryOverviewDialog } from "../../src/renderer/features/sidebar/repository-overview-dialog"
const noop = () => {}
function Fixture() {
  const surface = new URLSearchParams(location.search).get("surface") || "fleet"
  const [filters, setFilters] = useState<OrchestrationFleetFilters>({
    projectId: "",
    taskId: "",
    status: "",
    provider: "",
    state: "all",
    archiveScope: "visible",
    sort: "updated-desc",
  })
  const items = [
    item({ taskId: "one", taskName: "Improve the planning workspace", provider: "codex" }),
    item({
      taskId: "two",
      taskName: "Verify restoration after changing a very long named workspace",
      provider: "anthropic",
      freshness: "stale",
    }),
  ]
  return (
    <div className="h-screen bg-background text-foreground" data-fixture-surface={surface}>
      {surface === "automation" ? (
        <AutomationsView />
      ) : surface === "knowledge" ? (
        <ProjectVaultView />
      ) : surface === "workspaces" ? (
        <SavedWorkspacesView projectId="fixture" initialChatId="chat-1" />
      ) : surface === "plans" ? (
        <PlanView />
      ) : surface === "branches" ? (
        <RepositoryOverviewDialog
          open
          onOpenChange={noop}
          projectName="Sample project"
          projectPath="C:/sandbox"
        />
      ) : surface === "fleet" ? (
        <OrchestrationFleetPanel
          data={
            {
              items,
              total: 2,
              nextCursor: null,
              facets: {
                projects: [{ value: "project-1", label: "Flapstack", count: 2 }],
                tasks: [],
                statuses: [],
                providers: [],
              },
            } as any
          }
          filters={filters}
          isLoading={false}
          isFetching={false}
          error={null}
          canPrevious={false}
          onFiltersChange={setFilters}
          onRefresh={noop}
          onRetry={noop}
          onNext={noop}
          onPrevious={noop}
          onOpenChat={noop}
          onOpenWorkspace={noop}
        />
      ) : surface === "beta" ? (
        <AgentsBetaTab />
      ) : surface === "records" ? (
        <ProjectRecordsView />
      ) : (
        <main className="p-4">
          <h1 className="mb-4 text-lg font-semibold">Automations</h1>
          <div className="divide-y border-y">
            {[
              "Nightly project review",
              "Review a lengthy project name and gather outstanding questions",
              "Check releases",
            ].map((name, i) => (
              <AutomationCard
                key={name}
                onClick={noop}
                automation={
                  {
                    draft: { name, trigger: { type: "schedule" } },
                    state: i === 1 ? "draft" : "active",
                    approval: { state: i === 1 ? "pending" : "approved" },
                  } as any
                }
              />
            ))}
          </div>
        </main>
      )}
    </div>
  )
}
createRoot(document.getElementById("root")!).render(<Fixture />)
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
