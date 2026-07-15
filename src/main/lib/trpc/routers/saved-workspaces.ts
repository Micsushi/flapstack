import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  savedWorkspaceLayoutSchema,
  savedWorkspacePaneBindingSchema,
  savedWorkspaceScopeSchema,
} from "../../../../shared/saved-workspaces"
import { getDatabasePath } from "../../db"
import {
  SavedWorkspaceLifecycleError,
  SavedWorkspaceLifecycleService,
  type SavedWorkspaceRecord,
} from "../../saved-workspaces/service"
import { resolveSavedWorkspacePane } from "../../saved-workspaces/pane-adapters"
import {
  getOperationWorkspaceForTask,
  getOperationWorkspaceProjection,
  regenerateOperationWorkspace,
  SavedWorkspaceOperationError,
} from "../../saved-workspaces/operations"
import { publicProcedure, router } from "../index"

const id = z.string().trim().min(1).max(200)
const expectedVersion = z.number().int().positive()
const service = () => new SavedWorkspaceLifecycleService(getDatabasePath())

export const SAVED_WORKSPACE_TRPC_INVALIDATION = {
  queries: ["savedWorkspaces.list", "savedWorkspaces.get"],
} as const

function invalidation(workspaceIds: string[], removeWorkspaceIds: string[] = []) {
  return {
    ...SAVED_WORKSPACE_TRPC_INVALIDATION,
    workspaceIds,
    removeWorkspaceIds,
  }
}

function mutationResult(workspace: SavedWorkspaceRecord) {
  return { workspace, invalidation: invalidation([workspace.id]) }
}

function lifecycleError(error: unknown): never {
  if (!(error instanceof SavedWorkspaceLifecycleError)) throw error
  throw new TRPCError({
    code:
      error.code === "not-found"
        ? "NOT_FOUND"
        : error.code === "conflict"
          ? "CONFLICT"
          : "BAD_REQUEST",
    message: error.message,
  })
}

function lifecycleMutation<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    lifecycleError(error)
  }
}

function operationMutation<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (!(error instanceof SavedWorkspaceOperationError)) throw error
    throw new TRPCError({
      code:
        error.code === "not-found"
          ? "NOT_FOUND"
          : error.code === "conflict"
            ? "CONFLICT"
            : "PRECONDITION_FAILED",
      message: error.message,
    })
  }
}

export const savedWorkspacesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          projectId: id.optional(),
          taskId: id.optional(),
          archive: z.enum(["active", "archived", "all"]).default("active"),
          ownerKind: z.enum(["manual", "orchestration"]).optional(),
          search: z.string().max(256).optional(),
        })
        .default({}),
    )
    .query(({ input }) => lifecycleMutation(() => service().list(input))),

  get: publicProcedure
    .input(z.object({ workspaceId: id }))
    .query(({ input }) => lifecycleMutation(() => service().get(input.workspaceId))),

  getOperation: publicProcedure
    .input(z.object({ workspaceId: id }))
    .query(({ input }) =>
      operationMutation(() =>
        getOperationWorkspaceProjection(getDatabasePath(), input.workspaceId),
      ),
    ),

  getOperationForTask: publicProcedure
    .input(z.object({ taskId: id }))
    .query(({ input }) =>
      operationMutation(() => getOperationWorkspaceForTask(getDatabasePath(), input.taskId)),
    ),

  resolvePane: publicProcedure
    .input(z.object({ workspaceId: id, paneId: id }))
    .query(({ input }) =>
      lifecycleMutation(() =>
        resolveSavedWorkspacePane(getDatabasePath(), input.workspaceId, input.paneId),
      ),
    ),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(256),
        scope: savedWorkspaceScopeSchema,
        layout: savedWorkspaceLayoutSchema,
        sortOrder: z.string().trim().min(1).max(512).optional(),
      }),
    )
    .mutation(({ input }) => lifecycleMutation(() => mutationResult(service().create(input)))),

  saveLayout: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        layout: savedWorkspaceLayoutSchema,
      }),
    )
    .mutation(({ input }) => lifecycleMutation(() => mutationResult(service().saveLayout(input)))),

  rename: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        name: z.string().trim().min(1).max(256),
      }),
    )
    .mutation(({ input }) => lifecycleMutation(() => mutationResult(service().rename(input)))),

  duplicate: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        name: z.string().trim().min(1).max(256).optional(),
      }),
    )
    .mutation(({ input }) => lifecycleMutation(() => mutationResult(service().duplicate(input)))),

  archive: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        confirmActiveOperationImpact: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) =>
      lifecycleMutation(() => {
        const result = service().archive(input)
        return {
          ...result,
          invalidation: invalidation([result.workspace.id]),
        }
      }),
    ),

  restore: publicProcedure
    .input(z.object({ workspaceId: id, expectedVersion }))
    .mutation(({ input }) => lifecycleMutation(() => mutationResult(service().restore(input)))),

  previewDelete: publicProcedure
    .input(z.object({ workspaceId: id }))
    .query(({ input }) => lifecycleMutation(() => service().previewDelete(input.workspaceId))),

  delete: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        confirmActiveOperationImpact: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) =>
      lifecycleMutation(() => {
        const result = service().delete(input)
        return {
          ...result,
          invalidation: invalidation([], [input.workspaceId]),
        }
      }),
    ),

  repairBinding: publicProcedure
    .input(
      z.object({
        workspaceId: id,
        expectedVersion,
        paneId: id,
        binding: savedWorkspacePaneBindingSchema,
      }),
    )
    .mutation(({ input }) =>
      lifecycleMutation(() => mutationResult(service().repairBinding(input))),
    ),

  regenerateOperation: publicProcedure.input(z.object({ taskId: id })).mutation(({ input }) =>
    operationMutation(() => {
      const result = regenerateOperationWorkspace(getDatabasePath(), input.taskId)
      return {
        workspace: service().get(result.workspaceId),
        created: result.created,
        invalidation: invalidation([result.workspaceId]),
      }
    }),
  ),
})
