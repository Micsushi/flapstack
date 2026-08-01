import { z } from "zod"
import {
  FEATURE_VISIBILITY_REGISTRY,
  type FeatureVisibilityPreset,
} from "../../../../shared/feature-visibility"
import {
  FeatureVisibilityConflictError,
  FeatureVisibilityStore,
  type FeatureVisibilitySnapshot,
} from "../../feature-visibility/store"
import { publicProcedure, router } from "../index"
import { TRPCError } from "@trpc/server"

const profileKindSchema = z.enum(["fresh", "existing"])
const presetSchema = z.enum(["focused", "standard", "complete"])
const visibilitySchema = z
  .record(z.string().min(1).max(120), z.boolean())
  .refine(
    (visibility) => Object.keys(visibility).length <= FEATURE_VISIBILITY_REGISTRY.length + 50,
    "Feature visibility payload has too many entries.",
  )

export const FEATURE_VISIBILITY_CHANGED_EVENT = "feature-visibility:changed"

export function createFeatureVisibilityRouter(options: {
  path: string
  freshProfilePreset?: FeatureVisibilityPreset
  broadcast?: (snapshot: FeatureVisibilitySnapshot) => void
}) {
  const store = (profileKind: "fresh" | "existing") =>
    new FeatureVisibilityStore({
      path: options.path,
      profileKind,
      freshProfilePreset: options.freshProfilePreset,
    })

  return router({
    get: publicProcedure
      .input(z.object({ profileKind: profileKindSchema }))
      .query(({ input }) => store(input.profileKind).initialize()),

    applyChanges: publicProcedure
      .input(
        z.object({
          profileKind: profileKindSchema,
          expectedRevision: z.number().int().nonnegative(),
          preset: presetSchema,
          visibility: visibilitySchema,
        }),
      )
      .mutation(({ input }) => {
        try {
          const snapshot = store(input.profileKind).apply({
            expectedRevision: input.expectedRevision,
            preset: input.preset as FeatureVisibilityPreset,
            visibility: input.visibility,
          })
          options.broadcast?.(snapshot)
          return snapshot
        } catch (error) {
          if (error instanceof FeatureVisibilityConflictError) {
            throw new TRPCError({
              code: "CONFLICT",
              message: error.message,
              cause: error,
            })
          }
          throw error
        }
      }),
  })
}
