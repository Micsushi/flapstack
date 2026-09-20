import { createHash } from "node:crypto"
import { z } from "zod"
import type { ProjectPlanSnapshot } from "../../../shared/plan-sources"
import { planCandidateReferenceSchema } from "../../../shared/plan-task-promotion"
import type { PlanSourceLink } from "../../../shared/plan-kanban-consistency"
import { yapProposalSchema } from "../../../shared/project-records"
import { resolveCandidate } from "../plan-task-promotion"
import { linkPlanSource } from "../plan-kanban-consistency"
import { ProjectRecordsOperationError, type ProjectRecordsClient } from "./client"

export const recordsPlanPromotionSchema = z
  .object({
    reference: planCandidateReferenceSchema,
    destinationPath: z.string().regex(/^lanes\/(?:vault|flapstack)\/tasks\.md$/),
    projectId: z.string().min(1).max(200),
  })
  .strict()

export async function planDestinations(client: ProjectRecordsClient) {
  const index = await client.list()
  const destinations: { path: string; projectId: string; projectName: string }[] = []
  const projects = new Map<string, string>()
  for (const entry of index.documents.filter((entry) =>
    /\/(?:tasks|features)\.md$/.test(entry.path),
  )) {
    const snapshot = await client.read(entry.path)
    const projectId = /^projects\/([^/]+)\/features\.md$/.exec(entry.path)?.[1]
    if (projectId && !projects.has(projectId)) projects.set(projectId, projectId)
    for (const record of snapshot.document.records) {
      const parsed = z
        .array(z.object({ id: z.string(), name: z.string() }))
        .safeParse(record.projects)
      if (parsed.success) for (const project of parsed.data) projects.set(project.id, project.name)
    }
  }
  for (const entry of index.documents.filter((entry) => entry.path.endsWith("/tasks.md"))) {
    for (const [projectId, projectName] of projects)
      destinations.push({ path: entry.path, projectId, projectName })
  }
  return destinations
}

export async function proposePlanCandidate(
  client: ProjectRecordsClient,
  snapshot: ProjectPlanSnapshot,
  input: z.infer<typeof recordsPlanPromotionSchema>,
) {
  const { source, candidate } = resolveCandidate(snapshot, input.reference)
  const destination = (await planDestinations(client)).find(
    (item) => item.path === input.destinationPath && item.projectId === input.projectId,
  )
  if (!destination) throw new Error("Select an existing Records project and task destination.")
  // One immutable source/destination pair has one proposal, even across windows.
  const key = createHash("sha256")
    .update(JSON.stringify([input.reference, input.destinationPath, input.projectId]))
    .digest("hex")
  const proposalId = `plan-${key}`
  const visible = z
    .object({ proposals: z.array(yapProposalSchema) })
    .parse(await client.listYapProposals(input.projectId))
  const existing = visible.proposals.find((proposal) => proposal.proposalId === proposalId)
  if (existing) return existing
  const originalText = [
    candidate.title,
    candidate.body ?? "",
    `Source: ${candidate.path}:${candidate.line}`,
    `Source fingerprint: ${source.fingerprint}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  const captured = await client.createYapInput({
    inputId: `plan-${key}`,
    originalText,
    projectIds: [input.projectId],
    origin: {
      kind: "flapstack-plan",
      reference: input.reference,
      sourceType: source.type,
      title: candidate.title,
      body: candidate.body,
    },
  })
  // Reopen a durable proposal; never update owner corrections or approval.
  try {
    return await client.saveYapProposal({
      proposalId,
      idempotencyKey: `plan-${key}`,
      inputId: captured.inputId,
      inputVersion: captured.version,
      inputDigest: captured.inputDigest,
      rows: [
        {
          id: "plan-row",
          sourceSegmentIds: captured.segments.map((segment) => segment.id),
          sourceImageIds: [],
          interpretedRequest: candidate.title,
          projectId: input.projectId,
          projectName: destination.projectName,
          uncertainty: false,
          description: originalText,
        },
      ],
      actions: [
        {
          id: "plan-action",
          kind: "create",
          recordKind: "task",
          rowIds: ["plan-row"],
          record: {
            sourceLinks: [`${snapshot.rootPath}/${candidate.path}:${candidate.line}`],
            planSource: input.reference,
            planSourceType: source.type,
          },
          description: candidate.body ?? candidate.title,
          destination: { path: input.destinationPath },
        },
      ],
    })
  } catch (error) {
    if (!(error instanceof ProjectRecordsOperationError) || error.status !== 409) throw error
    return client.readYapProposal(proposalId)
  }
}

export async function recordsPlanLinks(
  client: ProjectRecordsClient,
  snapshot: ProjectPlanSnapshot,
): Promise<PlanSourceLink[]> {
  const { proposals } = z
    .object({ proposals: z.array(yapProposalSchema) })
    .parse(await client.listYapProposals())
  const links: PlanSourceLink[] = []
  for (const proposal of proposals) {
    if (!proposal.inputId.startsWith("plan-")) continue
    const input = await client.readYapInput(proposal.inputId)
    const origin = input.origin
    const parsed = planCandidateReferenceSchema.safeParse(origin?.reference)
    if (
      origin?.kind !== "flapstack-plan" ||
      !parsed.success ||
      parsed.data.sourceProjectId !== snapshot.projectId
    )
      continue
    const reference = parsed.data
    const title = proposal.rows[0]?.interpretedRequest ?? "Plan proposal"
    const actionRecord = z
      .object({ title: z.string().optional(), description: z.string().nullable().optional() })
      .passthrough()
      .safeParse(proposal.actions[0]?.record)
    const body =
      actionRecord.success && actionRecord.data.description !== undefined
        ? actionRecord.data.description
        : typeof proposal.actions[0]?.description === "string"
          ? proposal.actions[0].description
          : null
    links.push(
      linkPlanSource(snapshot, {
        kind: "proposal",
        id: proposal.proposalId,
        name: actionRecord.success ? (actionRecord.data.title ?? title) : title,
        description: body,
        status: proposal.status,
        version: proposal.version,
        projectId: snapshot.projectId,
        sourceType: origin.sourceType === "openspec" ? "openspec" : "markdown",
        sourcePath: reference.sourcePath,
        sourceCandidateId: reference.candidateId,
        sourceFingerprint: reference.sourceFingerprint,
      }),
    )
  }
  const index = await client.list()
  for (const entry of index.documents.filter((item) => item.path.endsWith("/tasks.md"))) {
    const document = await client.read(entry.path)
    for (const record of document.document.records) {
      const parsed = planCandidateReferenceSchema.safeParse(record.planSource)
      if (!parsed.success || parsed.data.sourceProjectId !== snapshot.projectId) continue
      const reference = parsed.data
      const source = snapshot.sources.find((item) => item.id === reference.sourceId)
      const link = linkPlanSource(snapshot, {
        kind: "task",
        id: record.id,
        name: record.title,
        description: typeof record.description === "string" ? record.description : null,
        status: record.state,
        version: 0,
        projectId: snapshot.projectId,
        sourceType:
          source?.type ?? (record.planSourceType === "openspec" ? "openspec" : "markdown"),
        sourcePath: reference.sourcePath,
        sourceCandidateId: reference.candidateId,
        sourceFingerprint: reference.sourceFingerprint,
      })
      link.entity.revision = document.revision
      links.push(link)
    }
  }
  return links
}
