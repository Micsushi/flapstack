export const planSourceTypes = ["openspec", "markdown"] as const
export type PlanSourceType = (typeof planSourceTypes)[number]

export const planCandidateKinds = [
  "proposal",
  "section",
  "requirement",
  "scenario",
  "task",
  "heading",
  "checklist",
] as const
export type PlanCandidateKind = (typeof planCandidateKinds)[number]

export type PlanParseIssueCode =
  "bounded" | "invalid-format" | "missing" | "read-failed" | "symlink" | "unsafe-path"

export interface PlanParseIssue {
  code: PlanParseIssueCode
  message: string
  path: string
  line?: number
}

export interface PlanCandidate {
  id: string
  fingerprint: string
  kind: PlanCandidateKind
  title: string
  body: string | null
  path: string
  line: number
  depth: number
  parentId: string | null
  completed: boolean | null
}

export type PlanSourceStatus = "current" | "stale" | "malformed"

export interface PlanSourceSnapshot {
  id: string
  type: PlanSourceType
  path: string
  fingerprint: string
  status: PlanSourceStatus
  stale: boolean
  candidates: PlanCandidate[]
  limitations: string[]
  errors: PlanParseIssue[]
}

export interface ProjectPlanSnapshot {
  projectId: string
  rootPath: string
  fingerprint: string
  sources: PlanSourceSnapshot[]
  limitations: string[]
}

export interface PlanSourceRefreshEvent {
  type: "refresh-required"
  projectId: string
  changedPaths: string[]
  snapshot: ProjectPlanSnapshot
}
