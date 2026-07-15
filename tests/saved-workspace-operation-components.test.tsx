// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceOperationProjection } from "../src/shared/saved-workspaces"

vi.mock("../src/renderer/features/terminal", () => ({
  Terminal: () => <div data-testid="live-terminal" />,
}))
vi.mock("../src/renderer/features/changes", () => ({ ChangesPanel: () => null }))
vi.mock("../src/renderer/features/file-viewer", () => ({ FileViewerSidebar: () => null }))
vi.mock("../src/renderer/lib/trpc", () => ({ trpc: {} }))

import {
  ArchivedFileReferencePane,
  OperationActivityPane,
  OperationRosterPane,
  OperationSelectedAgentPane,
  WorkspaceTerminalPane,
} from "../src/renderer/features/saved-workspaces/pane-adapters"
import { WorkspaceLifecycleImpact } from "../src/renderer/features/saved-workspaces/saved-workspaces-view"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("operation workspace panes", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("keeps every descendant keyboard reachable through a bounded navigator", () => {
    const select = vi.fn()
    act(() => root.render(<OperationRosterPane operation={projection()} onSelectAgent={select} />))

    expect(container.querySelector('[aria-label="Operation agent navigator"]')).not.toBeNull()
    expect(container.textContent).toContain("3 agent chats ready · 1 pending")
    expect(container.textContent).toContain("2 chats use navigator overflow")
    const buttons = [...container.querySelectorAll("button")]
    expect(buttons).toHaveLength(4)
    expect(buttons[3].disabled).toBe(true)
    act(() => buttons[1].click())
    expect(select).toHaveBeenCalledWith("agent-2")
  })

  it("keeps archived navigator controls disabled instead of presenting no-op actions", () => {
    act(() => root.render(<OperationRosterPane operation={projection()} />))

    const buttons = [...container.querySelectorAll("button")]
    expect(buttons).toHaveLength(4)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(buttons[0].getAttribute("aria-label")).toContain("read-only")
  })

  it("never starts an archived terminal while preserving active start behavior", () => {
    const pane = {
      id: "terminal-pane",
      binding: {
        type: "terminal" as const,
        cwd: "/workspace",
        worktreePath: "/workspace",
        restorePolicy: "prompt" as const,
      },
    }
    act(() =>
      root.render(
        <WorkspaceTerminalPane
          workspaceId="workspace-1"
          pane={pane}
          terminalCwd="/workspace"
          readOnly
        />,
      ),
    )
    expect(container.textContent).toContain("Restore this workspace")
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector('[data-testid="live-terminal"]')).toBeNull()

    act(() =>
      root.render(
        <WorkspaceTerminalPane workspaceId="workspace-1" pane={pane} terminalCwd="/workspace" />,
      ),
    )
    const start = container.querySelector<HTMLButtonElement>("button")
    expect(start?.textContent).toContain("Start fresh terminal")
    act(() => start?.click())
    expect(container.querySelector('[data-testid="live-terminal"]')).not.toBeNull()
  })

  it("renders archived file metadata without an enabled structural close action", () => {
    act(() => root.render(<ArchivedFileReferencePane path="/workspace/report.md" />))

    expect(container.textContent).toContain("/workspace/report.md")
    expect(container.textContent).toContain("Restore this workspace")
    expect(container.querySelector("button")).toBeNull()
  })

  it("shows honest selected-agent recovery without inventing a chat", () => {
    act(() =>
      root.render(<OperationSelectedAgentPane operation={projection()} agentId="agent-4" />),
    )
    expect(container.textContent).toContain("chat has not materialized yet")

    act(() =>
      root.render(<OperationSelectedAgentPane operation={projection()} agentId="missing" />),
    )
    expect(container.textContent).toContain("Selected agent missing")
  })

  it("exposes status and durable result summaries through accessible labels and live state", () => {
    act(() => root.render(<OperationActivityPane operation={projection()} />))
    expect(container.querySelector('[aria-label="Operation status and artifacts"]')).not.toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toContain("4 agents")
    expect(container.textContent).toContain("artifact: review.md")
    expect(container.textContent).toContain("No durable result or artifact summary yet.")
  })

  it("requires an accessible impact review before active operation metadata changes", () => {
    const cancel = vi.fn()
    const confirm = vi.fn()
    act(() =>
      root.render(
        <WorkspaceLifecycleImpact
          action="delete"
          workspaceName="Operation workspace"
          loading={false}
          ready
          error={null}
          operation={{
            status: "running",
            active: true,
            agentCount: 4,
            materializedChatCount: 3,
            canRegenerateFromLineage: true,
          }}
          referenceCount={6}
          pending={false}
          onCancel={cancel}
          onConfirm={confirm}
        />,
      ),
    )
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).toContain("The operation remains active and will not be stopped.")
    expect(container.textContent).toContain("regenerated from lineage")
    const buttons = [...container.querySelectorAll("button")]
    expect(document.activeElement).toBe(buttons[0])
    act(() => buttons[1].click())
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })
})

function projection(): SavedWorkspaceOperationProjection {
  const agents = [1, 2, 3, 4].map((index) => ({
    agentId: `agent-${index}`,
    chatId: index === 4 ? null : `chat-${index}`,
    chatName: index === 4 ? null : `Agent ${index} chat`,
    chatState: index === 4 ? ("pending" as const) : ("ready" as const),
    runId: index === 4 ? null : `run-${index}`,
    parentAgentId: index === 1 ? null : "agent-1",
    replacedAgentId: null,
    role: index === 2 ? "Reviewer" : "Worker",
    name: `Agent ${index}`,
    harness: "codex",
    status: index === 4 ? "queued" : index === 2 ? "completed" : "active",
    progressPercent: index === 4 ? 0 : 50,
    resultSummary: index === 2 ? "artifact: review.md" : null,
    stopReason: null,
    blockerCount: 0,
    queuedAt: index,
    startedAt: index === 4 ? null : index + 1,
    completedAt: index === 2 ? 10 : null,
  }))
  return {
    workspaceId: "workspace-1",
    orchestrationId: "operation-1",
    taskId: "task-1",
    taskName: "Saved workspace operation",
    projectId: "project-1",
    initiatingChatId: "lead-chat",
    initiatingChatName: "Lead",
    status: "running",
    roster: [
      { kind: "lead", chatId: "lead-chat", agentId: null, order: 0 },
      ...agents.slice(0, 3).map((agent, index) => ({
        kind: "agent" as const,
        chatId: agent.chatId!,
        agentId: agent.agentId,
        order: index + 1,
      })),
    ],
    agents,
    materializedAgentCount: 3,
    pendingAgentCount: 1,
    overflowChatCount: 2,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
  }
}
