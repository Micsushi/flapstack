import { z } from "zod"

export const providerAuthModes = [
  "system-default",
  "subscription",
  "api-key",
  "local",
  "legacy",
] as const

export const providerAccountSnapshotSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    accountId: z.string().trim().min(1).max(200),
    authMode: z.enum(providerAuthModes),
    runtimeTarget: z.string().trim().min(1).max(200),
    credentialRevision: z.string().trim().min(1).max(200),
  })
  .strict()

export type ProviderAccountSnapshot = z.infer<typeof providerAccountSnapshotSchema>
