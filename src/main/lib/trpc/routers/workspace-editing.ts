import { betaProcedure, router } from "../index"
import { BrowserWindow } from "electron"
import type { Context } from "../index"
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
  updateWorkspaceDraftSchema,
  releaseWorkspaceDraftSchema,
} from "../../../../shared/workspace-edits"

const procedure = betaProcedure("workspaceEditing")
const service = () => new WorkspaceEditingService(getDatabase())
function draftOwner(ctx: Context) {
  const window = ctx.getWindow()
  if (!window || window.isDestroyed()) throw new Error("An active desktop window is required")
  return {
    windowId: window.id,
    isAlive: (id: number) => {
      const candidate = BrowserWindow.fromId(id)
      return !!candidate && !candidate.isDestroyed()
    },
  }
}
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
  openDraft: procedure
    .input(workspaceEditTargetSchema)
    .mutation(({ input, ctx }) => service().openDraft(input, draftOwner(ctx))),
  updateDraft: procedure
    .input(updateWorkspaceDraftSchema)
    .mutation(({ input, ctx }) => service().updateDraft(input, draftOwner(ctx))),
  releaseDraft: procedure
    .input(releaseWorkspaceDraftSchema)
    .mutation(({ input, ctx }) => service().releaseDraft(input, draftOwner(ctx))),
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
