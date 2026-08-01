export type WorkbenchWindowState = "available" | "recovering"
export type WorkbenchWindowKind = "main" | "chat" | "workspace"

export interface WorkbenchWindowDestination {
  stableId: string
  label: string
  kind: WorkbenchWindowKind
  state: WorkbenchWindowState
  hasProject: boolean
  hasChat: boolean
  actions: readonly ("focus" | "cancel")[]
}

export type WorkbenchWindowCreationFailureReason =
  "window-limit" | "reservation-expired" | "creation-failed"

export type WorkbenchWindowCreationFailure =
  | {
      reason: "window-limit"
      destinations: WorkbenchWindowDestination[]
    }
  | {
      reason: "reservation-expired" | "creation-failed"
      destinations?: never
    }

export type WorkbenchWindowCreationBlocked = WorkbenchWindowCreationFailure

export type WorkbenchNewWindowResult =
  | { blocked: false }
  | { blocked: true; reason: "already-open" }
  | ({ blocked: true } & WorkbenchWindowCreationFailure)
