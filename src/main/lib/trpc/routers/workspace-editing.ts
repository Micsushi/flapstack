import { betaProcedure, router } from "../index"
import { getDatabase } from "../../db"
import {
  WorkspaceEditingService,
  WorkspaceEditConflictError,
} from "../../workspace-editing/service"
import {
  workspaceEditScopeSchema,
  workspaceEditTargetSchema,
  saveWorkspaceEditSchema,
  revertWorkspaceEditSchema,
  saveAsWorkspaceEditSchema,
  renameWorkspaceEditSchema,
} from "../../../../shared/workspace-edits"

const procedure = betaProcedure("workspaceEditing")
const service = () => new WorkspaceEditingService(getDatabase())
async function mutation(action: () => ReturnType<WorkspaceEditingService["save"]>) {
  try {
    const operation = await action()
    return operation.state === "applied"
      ? { ok: true as const, operation }
      : { ok: false as const, reason: operation.state, operation }
  } catch (error) {
    if (error instanceof WorkspaceEditConflictError)
      return { ok: false as const, reason: "conflict" as const, diskSha256: error.diskSha256 }
    throw error
  }
}
export const workspaceEditingRouter = router({
  read: procedure.input(workspaceEditTargetSchema).query(({ input }) => service().read(input)),
  history: procedure.input(workspaceEditScopeSchema).query(({ input }) => service().history(input)),
  save: procedure
    .input(saveWorkspaceEditSchema)
    .mutation(({ input }) => mutation(() => service().save(input))),
  revert: procedure
    .input(revertWorkspaceEditSchema)
    .mutation(({ input }) => mutation(() => service().revert(input))),
  saveAs: procedure
    .input(saveAsWorkspaceEditSchema)
    .mutation(({ input }) => mutation(() => service().saveAs(input))),
  rename: procedure
    .input(renameWorkspaceEditSchema)
    .mutation(({ input }) => mutation(() => service().rename(input))),
})
