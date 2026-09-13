import { describe, expect, it, vi } from "vitest"
import { ProjectRecordsClient } from "../src/main/lib/project-records/client"
import { assertLegacyTaskTransitionAllowed } from "../src/main/lib/project-records/legacy-task-boundary"
import { moveTaskKanbanCard, archiveTaskKanbanCard } from "../src/main/lib/task-kanban"
import { promotePlanCandidate } from "../src/main/lib/plan-task-promotion"
import { TaskProposalService } from "../src/main/lib/task-proposals"

describe("shared canonical board boundary", () => {
  it("forwards exact workflow revisions, worker and evidence; retains rejection details", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Claimed by another worker" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47839",
      token: "private-test-token",
      fetch,
    })
    const body = JSON.stringify({
      path: "lanes/vault/tasks.md",
      expectedRevision: "a".repeat(64),
      recordId: "task",
      action: "claim",
      data: {},
    })
    const result = await client.boardRequest({ path: "/v1/workflow", method: "POST", body })
    expect(result.status).toBe(400)
    expect(JSON.parse(result.body).message).toContain("Claimed")
    expect(fetch.mock.calls[0][1].body).toBe(body)
    expect(result.body).not.toContain("private-test-token")
  })
  it("rejects arbitrary endpoint and session mutations before network access", async () => {
    const fetch = vi.fn()
    const client = new ProjectRecordsClient({
      endpoint: "http://127.0.0.1:47839",
      token: "private-test-token",
      fetch,
    })
    for (const path of [
      "https://evil.invalid/v1/record",
      "//evil.invalid/v1/record",
      "/v1/session",
      "/v1/session/disconnect",
      "/v1/record?bypass=true",
      "/v1/../admin",
    ]) {
      await expect(client.boardRequest({ path, method: "POST", body: "{}" })).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it("blocks legacy move and plan promotion before any DB access in canonical mode", () => {
    vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
    try {
      expect(() => assertLegacyTaskTransitionAllowed()).toThrow("Project records owns")
      expect(() =>
        moveTaskKanbanCard(null as never, {
          id: "legacy",
          expectedVersion: 1,
          targetStatus: "done",
        }),
      ).toThrow("Project records owns")
      expect(() => promotePlanCandidate(null as never, null as never, null as never)).toThrow(
        "Project records owns",
      )
      expect(() =>
        archiveTaskKanbanCard(null as never, { id: "legacy", expectedVersion: 1 }),
      ).toThrow("Project records owns")
      const proposals = new TaskProposalService("must-not-be-created.sqlite")
      expect(() =>
        proposals.approveBatch({ type: "user", id: "owner" }, { approvals: [] }),
      ).toThrow("Project records owns")
      expect(() => proposals.approve({ type: "user", id: "owner" }, null as never)).toThrow(
        "Project records owns",
      )
      expect(() => assertLegacyTaskTransitionAllowed({})).not.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
