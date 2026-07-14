import { z } from "zod"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  providerExtensionMutationSchema,
} from "../../provider-extensions"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { publicProcedure, router } from "../index"
import {
  extensionBaselineGaps,
  extensionCapabilityRegistry,
  extensionHarnessBaselines,
  EXTENSION_CAPABILITY_SCHEMA_VERSION,
} from "../../extension-management"

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
})
