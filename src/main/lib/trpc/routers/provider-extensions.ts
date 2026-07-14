import { z } from "zod"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  providerExtensionMutationSchema,
} from "../../provider-extensions"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { publicProcedure, router } from "../index"
import {
  applyNativeExtensionMutation,
  applyCrossHarnessCopy,
  crossHarnessCopyApplySchema,
  crossHarnessCopyPreviewSchema,
  extensionBaselineGaps,
  extensionCapabilityRegistry,
  extensionHarnessBaselines,
  EXTENSION_CAPABILITY_SCHEMA_VERSION,
  nativeExtensionApplySchema,
  nativeExtensionMutationSchema,
  nativeExtensionRestoreSchema,
  nativeExtensionTargetSchema,
  previewNativeExtensionMutation,
  previewCrossHarnessCopy,
  readNativeExtension,
  restoreNativeExtensionBackup,
} from "../../extension-management"

function registeredNativeTarget<T extends z.infer<typeof nativeExtensionTargetSchema>>(
  target: T,
): T {
  if (target.scope !== "project") return { ...target, cwd: undefined }
  if (!target.cwd) throw new Error("Project-scoped extensions require a registered project")
  return { ...target, cwd: assertRegisteredWorktree(target.cwd).canonicalPath }
}

export const providerExtensionsRouter = router({
  getCapabilities: publicProcedure.query(() => ({
    schemaVersion: EXTENSION_CAPABILITY_SCHEMA_VERSION,
    harnesses: extensionHarnessBaselines,
    capabilities: extensionCapabilityRegistry,
    additiveGaps: extensionBaselineGaps,
  })),

  list: publicProcedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(({ input }) => {
      const cwd = input?.cwd ? assertRegisteredWorktree(input.cwd).canonicalPath : undefined
      return discoverProviderExtensions({ cwd })
    }),

  mutate: publicProcedure.input(providerExtensionMutationSchema).mutation(({ input }) => {
    if (input.source === "project") {
      if (!input.cwd) throw new Error("Project-scoped extensions require a registered project")
      const cwd = assertRegisteredWorktree(input.cwd).canonicalPath
      return mutateProviderExtension({ ...input, cwd })
    }
    return mutateProviderExtension({ ...input, cwd: undefined })
  }),

  readNative: publicProcedure.input(nativeExtensionTargetSchema).query(({ input }) => {
    return readNativeExtension(registeredNativeTarget(input))
  }),

  previewNativeMutation: publicProcedure.input(nativeExtensionMutationSchema).query(({ input }) => {
    return previewNativeExtensionMutation({
      ...input,
      target: registeredNativeTarget(input.target),
    })
  }),

  applyNativeMutation: publicProcedure.input(nativeExtensionApplySchema).mutation(({ input }) => {
    return applyNativeExtensionMutation({
      ...input,
      target: registeredNativeTarget(input.target),
    })
  }),

  restoreNativeBackup: publicProcedure.input(nativeExtensionRestoreSchema).mutation(({ input }) => {
    return restoreNativeExtensionBackup({
      ...input,
      target: registeredNativeTarget(input.target),
    })
  }),

  previewCrossHarnessCopy: publicProcedure
    .input(crossHarnessCopyPreviewSchema)
    .query(({ input }) => {
      return previewCrossHarnessCopy({
        ...input,
        source: registeredNativeTarget(input.source),
        target: registeredNativeTarget(input.target),
      })
    }),

  applyCrossHarnessCopy: publicProcedure
    .input(crossHarnessCopyApplySchema)
    .mutation(({ input }) => {
      return applyCrossHarnessCopy({
        ...input,
        source: registeredNativeTarget(input.source),
        target: registeredNativeTarget(input.target),
      })
    }),
})
