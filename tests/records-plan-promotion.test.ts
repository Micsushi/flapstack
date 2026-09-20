import { describe, expect, it, vi } from "vitest"
import {
  planDestinations,
  proposePlanCandidate,
  recordsPlanLinks,
} from "../src/main/lib/project-records/plan-promotion"
import {
  ProjectRecordsOperationError,
  type ProjectRecordsClient,
} from "../src/main/lib/project-records/client"
import type { ProjectPlanSnapshot } from "../src/shared/plan-sources"

const reference = {
  sourceProjectId: "local-project",
  sourceId: "source",
  sourcePath: "plan.md",
  sourceFingerprint: "source-hash",
  candidateId: "candidate",
  candidateFingerprint: "candidate-hash",
}
function snapshot(): ProjectPlanSnapshot {
  return {
    projectId: "local-project",
    rootPath: "/repo",
    fingerprint: "root-hash",
    limitations: [],
    sources: [
      {
        id: "source",
        type: "markdown",
        path: "plan.md",
        fingerprint: "source-hash",
        stale: false,
        status: "current",
        limitations: [],
        errors: [],
        candidates: [
          {
            id: "candidate",
            fingerprint: "candidate-hash",
            kind: "checklist",
            title: "Retain answers",
            body: "Acceptance: reopen preserves answers",
            path: "plan.md",
            line: 3,
            depth: 1,
            parentId: null,
            completed: false,
          },
        ],
      },
    ],
  }
}
function fixture() {
  const inputs = new Map<string, any>()
  const proposals = new Map<string, any>()
  const records: any[] = [{ projects: [{ id: "flapstack", name: "Flapstack" }] }]
  const client = {
    list: vi.fn(async () => ({ documents: [{ path: "lanes/flapstack/tasks.md" }] })),
    read: vi.fn(async () => ({
      revision: "b".repeat(64),
      document: { records },
    })),
    createYapInput: vi.fn(async (input) => {
      const saved = {
        ...input,
        version: 1,
        inputDigest: "a".repeat(64),
        segments: [{ id: "segment-1" }],
      }
      inputs.set(input.inputId, saved)
      return saved
    }),
    saveYapProposal: vi.fn(async (proposal) => {
      const saved = proposals.get(proposal.idempotencyKey) ?? {
        ...proposal,
        version: 1,
        creatorId: "fixture",
        status: "proposed",
        executable: false,
        actions: proposal.actions.map((action: any) => ({ ...action, executable: false })),
      }
      proposals.set(proposal.idempotencyKey, saved)
      return saved
    }),
    listYapProposals: vi.fn(async () => ({ proposals: [...proposals.values()] })),
    readYapProposal: vi.fn(async (id) => {
      const proposal = [...proposals.values()].find((item) => item.proposalId === id)
      if (!proposal) throw new ProjectRecordsOperationError(404, {})
      return proposal
    }),
    readYapInput: vi.fn(async (id) => inputs.get(id)),
  }
  return {
    client: client as unknown as ProjectRecordsClient,
    calls: client,
    inputs,
    proposals,
    records,
  }
}
const request = { reference, destinationPath: "lanes/flapstack/tasks.md", projectId: "flapstack" }

describe("canonical Plan proposals", () => {
  it("offers a project feature document before its first task exists", async () => {
    const { client, calls, records } = fixture()
    records.length = 0
    calls.list.mockResolvedValue({
      documents: [
        { path: "lanes/flapstack/tasks.md" },
        { path: "projects/first-project/features.md" },
      ],
    })
    expect(await planDestinations(client)).toEqual([
      {
        path: "lanes/flapstack/tasks.md",
        projectId: "first-project",
        projectName: "first-project",
      },
    ])
  })
  it("uses explicit canonical destinations and creates one inert proposal for concurrent requests", async () => {
    const { client, calls, proposals } = fixture()
    expect(await planDestinations(client)).toEqual([
      { path: request.destinationPath, projectId: "flapstack", projectName: "Flapstack" },
    ])
    const [a, b] = await Promise.all([
      proposePlanCandidate(client, snapshot(), request),
      proposePlanCandidate(client, snapshot(), request),
    ])
    expect(a.proposalId).toBe(b.proposalId)
    expect(proposals.size).toBe(1)
    expect(a.executable).toBe(false)
    expect(calls.saveYapProposal.mock.calls[0]![0].actions[0].record.planSource).toEqual(reference)
    expect(calls.saveYapProposal.mock.calls[0]![0].actions[0].description).toContain(
      "Acceptance: reopen preserves answers",
    )
  })
  it("refuses stale, completed, or unmapped candidates before any write", async () => {
    for (const kind of ["stale", "completed", "unmapped"]) {
      const { client, calls } = fixture()
      const source = snapshot()
      if (kind === "stale") source.sources[0]!.fingerprint = "changed"
      if (kind === "completed") source.sources[0]!.candidates[0]!.completed = true
      await expect(
        proposePlanCandidate(client, source, {
          ...request,
          projectId: kind === "unmapped" ? "local-project" : "flapstack",
        }),
      ).rejects.toThrow()
      expect(calls.createYapInput).not.toHaveBeenCalled()
    }
  })
  it("reopens reviewed corrections without updating the proposal", async () => {
    const { client, calls } = fixture()
    const saved = await proposePlanCandidate(client, snapshot(), request)
    saved.rows[0]!.interpretedRequest = "Owner correction"
    saved.status = "approved"
    const reopened = await proposePlanCandidate(client, snapshot(), request)
    expect(reopened.proposalId).toBe(saved.proposalId)
    expect(reopened.rows[0]!.interpretedRequest).toBe("Owner correction")
    expect(calls.saveYapProposal).toHaveBeenCalledOnce()
  })
  it("compares immutable captured content after edits without changing canonical work", async () => {
    const { client, calls } = fixture()
    await proposePlanCandidate(client, snapshot(), request)
    expect((await recordsPlanLinks(client, snapshot()))[0]!.status).toBe("current")
    const stale = snapshot()
    stale.sources[0]!.stale = true
    stale.sources[0]!.status = "stale"
    expect((await recordsPlanLinks(client, stale))[0]!.status).toBe("diverged")
    const changed = snapshot()
    changed.sources[0]!.fingerprint = "edited"
    changed.sources[0]!.candidates[0]!.title = "Changed request"
    const [link] = await recordsPlanLinks(client, changed)
    expect(link!.status).toBe("diverged")
    expect(link!.compare).toMatchObject({
      durableTitle: "Retain answers",
      currentSourceTitle: "Changed request",
      contentDiffers: true,
    })
    expect(calls.saveYapProposal).toHaveBeenCalledTimes(1)
    changed.sources = []
    expect((await recordsPlanLinks(client, changed))[0]!.status).toBe("source-missing")
  })
  it("shows current canonical task content and document revision without conflating local projects", async () => {
    const { client, records } = fixture()
    records.push({
      id: "canonical-task",
      title: "Owner revised title",
      description: "Owner revised acceptance",
      state: "planned",
      planSource: reference,
      planSourceType: "markdown",
    })
    records.push({
      id: "other-task",
      title: "Other",
      planSource: { ...reference, sourceProjectId: "other-local-project" },
    })
    const links = await recordsPlanLinks(client, snapshot())
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      kind: "task",
      entity: { id: "canonical-task", revision: "b".repeat(64) },
      compare: {
        durableTitle: "Owner revised title",
        durableBody: "Owner revised acceptance",
        contentDiffers: true,
      },
    })
  })
})
