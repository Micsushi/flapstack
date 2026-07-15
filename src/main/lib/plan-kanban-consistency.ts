import { and, asc, eq, isNotNull } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { PlanSourceLink, PlanSourceLinkStatus } from "../../shared/plan-kanban-consistency"
import type { PlanSourceSnapshot, ProjectPlanSnapshot } from "../../shared/plan-sources"
import * as schema from "./db/schema"
import { taskProposals, tasks } from "./db/schema"

type Database = BetterSQLite3Database<typeof schema>

type ProvenanceRow = {
  kind: "task" | "proposal"
  id: string
  projectId: string
  name: string
  description: string | null
  status: string
  version: number
  sourceType: string | null
  sourcePath: string | null
  sourceCandidateId: string | null
  sourceFingerprint: string | null
}

export function listPlanSourceLinks(
  database: Database,
  snapshot: ProjectPlanSnapshot,
): PlanSourceLink[] {
  const taskRows: ProvenanceRow[] = database
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      name: tasks.name,
      description: tasks.description,
      status: tasks.status,
      version: tasks.version,
      sourceType: tasks.sourceType,
      sourcePath: tasks.sourcePath,
      sourceCandidateId: tasks.sourceCandidateId,
      sourceFingerprint: tasks.sourceFingerprint,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, snapshot.projectId),
        isNotNull(tasks.sourceType),
        isNotNull(tasks.sourcePath),
        isNotNull(tasks.sourceCandidateId),
        isNotNull(tasks.sourceFingerprint),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
    .all()
    .map((row) => ({ kind: "task", ...row }))

  const proposalRows: ProvenanceRow[] = database
    .select({
      id: taskProposals.id,
      projectId: taskProposals.projectId,
      name: taskProposals.name,
      description: taskProposals.description,
      status: taskProposals.status,
      version: taskProposals.version,
      sourceType: taskProposals.sourceType,
      sourcePath: taskProposals.sourcePath,
      sourceCandidateId: taskProposals.sourceCandidateId,
      sourceFingerprint: taskProposals.sourceFingerprint,
    })
    .from(taskProposals)
    .where(
      and(
        eq(taskProposals.projectId, snapshot.projectId),
        isNotNull(taskProposals.sourceType),
        isNotNull(taskProposals.sourcePath),
        isNotNull(taskProposals.sourceCandidateId),
        isNotNull(taskProposals.sourceFingerprint),
      ),
    )
    .orderBy(asc(taskProposals.createdAt), asc(taskProposals.id))
    .all()
    .map((row) => ({ kind: "proposal", ...row }))

  return [...taskRows, ...proposalRows].map((row) => linkRow(snapshot, row))
}

function linkRow(snapshot: ProjectPlanSnapshot, row: ProvenanceRow): PlanSourceLink {
  const provenance = {
    sourceType: row.sourceType as "openspec" | "markdown",
    sourcePath: row.sourcePath!,
    sourceCandidateId: row.sourceCandidateId!,
    sourceFingerprint: row.sourceFingerprint!,
  }
  const source = findSource(snapshot.sources, provenance)
  const candidate =
    source?.candidates.find((item) => item.id === provenance.sourceCandidateId) ?? null
  const status = resolveStatus(source, candidate !== null, provenance.sourceFingerprint)
  return {
    kind: row.kind,
    entity: {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      version: row.version,
    },
    projectId: row.projectId,
    provenance,
    status,
    diverged: status !== "current",
    source: source
      ? {
          id: source.id,
          type: source.type,
          path: source.path,
          fingerprint: source.fingerprint,
          status: source.status,
        }
      : null,
    candidate,
    compare: {
      durableTitle: row.name,
      durableBody: row.description,
      currentSourceTitle: candidate?.title ?? null,
      currentSourceBody: candidate?.body ?? null,
      contentDiffers:
        candidate === null ||
        candidate.title !== row.name ||
        (candidate.body ?? null) !== row.description,
    },
  }
}

function findSource(
  sources: readonly PlanSourceSnapshot[],
  provenance: {
    sourceType: "openspec" | "markdown"
    sourcePath: string
    sourceCandidateId: string
  },
): PlanSourceSnapshot | null {
  const typed = sources.filter((source) => source.type === provenance.sourceType)
  return (
    typed.find((source) =>
      source.candidates.some((candidate) => candidate.id === provenance.sourceCandidateId),
    ) ??
    typed.find(
      (source) =>
        source.path === provenance.sourcePath ||
        provenance.sourcePath.startsWith(`${source.path.replace(/\/$/, "")}/`),
    ) ??
    null
  )
}

function resolveStatus(
  source: PlanSourceSnapshot | null,
  candidateExists: boolean,
  storedFingerprint: string,
): PlanSourceLinkStatus {
  if (!source) return "source-missing"
  if (source.status === "malformed") return "malformed"
  if (!candidateExists) return "candidate-missing"
  return source.fingerprint === storedFingerprint ? "current" : "diverged"
}
