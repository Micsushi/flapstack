import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  providerExtensionMutationSchema,
} from "../../provider-extensions"
import { getDatabase, projects } from "../../db"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { publicProcedure, router } from "../index"
import {
  applyNativeExtensionMutation,
  applyCrossHarnessCopy,
  clearExtensionEnablementPolicy,
  crossHarnessCopyApplySchema,
  crossHarnessCopyPreviewSchema,
  extensionBaselineGaps,
  extensionCapabilityRegistry,
  extensionHarnessBaselines,
  extensionPolicyLocationSchema,
  extensionPolicyTargetFromManifest,
  EXTENSION_CAPABILITY_SCHEMA_VERSION,
  nativeExtensionApplySchema,
  nativeExtensionMutationSchema,
  nativeExtensionRestoreSchema,
  nativeExtensionTargetSchema,
  previewNativeExtensionMutation,
  previewCrossHarnessCopy,
  readNativeExtension,
  resolveExtensionEnablement,
  resolveExtensionInventoryState,
  restoreNativeExtensionBackup,
  setExtensionEnablementPolicy,
} from "../../extension-management"

function registeredNativeTarget<T extends z.infer<typeof nativeExtensionTargetSchema>>(
  target: T,
): T {
  if (target.scope !== "project") return { ...target, cwd: undefined }
  if (!target.cwd) throw new Error("Project-scoped extensions require a registered project")
  return { ...target, cwd: assertRegisteredWorktree(target.cwd).canonicalPath }
}

const resolvedStateInputSchema = z
  .object({
    cwd: z.string().optional(),
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
  })
  .strict()
  .refine((input) => !input.taskId || input.projectId, {
    message: "Task-scoped extension state requires a projectId.",
  })

const policyMutationSchema = z
  .object({
    extensionId: z.string().min(1),
    cwd: z.string().optional(),
    location: extensionPolicyLocationSchema,
  })
  .strict()

function policyProjectId(
  input:
    | z.infer<typeof resolvedStateInputSchema>
    | { location: z.infer<typeof extensionPolicyLocationSchema> },
): string | undefined {
  if ("location" in input) {
    return input.location.type === "user" ? undefined : input.location.projectId
  }
  return input.projectId
}

function resolvePolicyCwd(
  input:
    | z.infer<typeof resolvedStateInputSchema>
    | (z.infer<typeof policyMutationSchema> & { cwd?: string }),
): string | undefined {
  if (input.cwd) return assertRegisteredWorktree(input.cwd).canonicalPath
  const projectId = policyProjectId(input)
  if (!projectId) return undefined
  const project = getDatabase()
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) throw new Error("Project not found")
  return assertRegisteredWorktree(project.path).canonicalPath
}

async function policyManifest(extensionId: string, cwd?: string) {
  const extension = (await discoverProviderExtensions({ cwd })).find(
    (candidate) => candidate.id === extensionId,
  )
  if (!extension) throw new Error("Extension not found in the requested inventory")
  if (extension.capabilities.discovery === "unknown") {
    throw new Error(
      extension.limitations[0] ?? "Extension policy is unavailable while discovery is unsupported.",
    )
  }
  return extension
}

export const providerExtensionsRouter = router({
  getCapabilities: publicProcedure.query(() => ({
    schemaVersion: EXTENSION_CAPABILITY_SCHEMA_VERSION,
    harnesses: extensionHarnessBaselines,
    capabilities: extensionCapabilityRegistry,
    additiveGaps: extensionBaselineGaps,
  })),

  getResolvedState: publicProcedure
    .input(resolvedStateInputSchema.optional())
    .query(async ({ input }) => {
      const values = input ?? {}
      return resolveExtensionInventoryState(getDatabase(), {
        cwd: resolvePolicyCwd(values),
        ...(values.projectId ? { projectId: values.projectId } : {}),
        ...(values.taskId ? { taskId: values.taskId } : {}),
      })
    }),

  setEnablementPolicy: publicProcedure
    .input(policyMutationSchema.extend({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const cwd = resolvePolicyCwd(input)
      const extension = await policyManifest(input.extensionId, cwd)
      return setExtensionEnablementPolicy(getDatabase(), {
        target: extensionPolicyTargetFromManifest(extension),
        location: input.location,
        enabled: input.enabled,
      })
    }),

  clearEnablementPolicy: publicProcedure.input(policyMutationSchema).mutation(async ({ input }) => {
    const cwd = resolvePolicyCwd(input)
    const extension = await policyManifest(input.extensionId, cwd)
    return clearExtensionEnablementPolicy(getDatabase(), {
      target: extensionPolicyTargetFromManifest(extension),
      location: input.location,
    })
  }),

  resolveEnablement: publicProcedure.input(policyMutationSchema).query(async ({ input }) => {
    const cwd = resolvePolicyCwd(input)
    const extension = await policyManifest(input.extensionId, cwd)
    return resolveExtensionEnablement(getDatabase(), {
      target: extensionPolicyTargetFromManifest(extension),
      ...(input.location.type === "project" ? { projectId: input.location.projectId } : {}),
      ...(input.location.type === "task"
        ? { projectId: input.location.projectId, taskId: input.location.taskId }
        : {}),
    })
  }),

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
