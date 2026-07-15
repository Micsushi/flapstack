import type { PlanCandidate, PlanSourceStatus, PlanSourceType } from "./plan-sources"

export type PlanSourceLinkKind = "task" | "proposal"
export type PlanSourceLinkStatus =
  "current" | "diverged" | "source-missing" | "candidate-missing" | "malformed"

export interface PlanSourceLink {
  kind: PlanSourceLinkKind
  entity: {
    id: string
    name: string
    description: string | null
    status: string
    version: number
  }
  projectId: string
  provenance: {
    sourceType: PlanSourceType
    sourcePath: string
    sourceCandidateId: string
    sourceFingerprint: string
  }
  status: PlanSourceLinkStatus
  diverged: boolean
  source: {
    id: string
    type: PlanSourceType
    path: string
    fingerprint: string
    status: PlanSourceStatus
  } | null
  candidate: PlanCandidate | null
  compare: {
    durableTitle: string
    durableBody: string | null
    currentSourceTitle: string | null
    currentSourceBody: string | null
    contentDiffers: boolean
  }
}

export function describePlanSourceLinkStatus(status: PlanSourceLinkStatus): string {
  switch (status) {
    case "current":
      return "Source current"
    case "diverged":
      return "Source changed"
    case "source-missing":
      return "Source missing"
    case "candidate-missing":
      return "Plan item missing"
    case "malformed":
      return "Source malformed"
  }
}
