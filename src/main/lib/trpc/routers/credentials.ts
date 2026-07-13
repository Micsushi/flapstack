import { z } from "zod"
import { CREDENTIAL_IDS } from "../../../../shared/credential-types"
import { credentialFingerprint, getCredentialService } from "../../credential-service"
import { publicProcedure, router } from "../index"

const credentialIdSchema = z.enum(CREDENTIAL_IDS)
const metadataSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    baseUrl: z.string().trim().url().max(2_000).optional(),
  })
  .optional()

const legacyCredentialIds = {
  "onboarding:codex-api-key": "codex.api-key",
  "agents:openai-api-key": "openai.voice-api-key",
  "agents:claude-custom-config": "claude.custom-api-token",
} as const

export const credentialsRouter = router({
  listStatuses: publicProcedure.query(() => getCredentialService().listStatuses()),

  status: publicProcedure.input(z.object({ id: credentialIdSchema })).query(({ input }) => {
    return getCredentialService().status(input.id)
  }),

  set: publicProcedure
    .input(
      z.object({
        id: credentialIdSchema,
        secret: z
          .string()
          .min(1)
          .max(64 * 1024),
        metadata: metadataSchema,
      }),
    )
    .mutation(({ input }) => {
      return getCredentialService().set(input.id, input.secret, { metadata: input.metadata })
    }),

  migrateLegacy: publicProcedure
    .input(
      z.object({
        id: credentialIdSchema,
        legacyKey: z.enum([
          "onboarding:codex-api-key",
          "agents:openai-api-key",
          "agents:claude-custom-config",
        ]),
        secret: z
          .string()
          .min(1)
          .max(64 * 1024),
        expectedFingerprint: z.string().regex(/^[a-f0-9]{12}$/),
        metadata: metadataSchema,
      }),
    )
    .mutation(({ input }) => {
      if (legacyCredentialIds[input.legacyKey] !== input.id) {
        return {
          ...getCredentialService().status(input.id),
          acknowledged: false,
          warning: "Legacy migration source does not match the credential destination.",
        }
      }
      const actualFingerprint = credentialFingerprint(input.secret.trim())
      if (actualFingerprint !== input.expectedFingerprint) {
        return {
          ...getCredentialService().status(input.id),
          acknowledged: false,
          warning: "Legacy migration fingerprint did not match. The source was not cleared.",
        }
      }
      return getCredentialService().set(input.id, input.secret, {
        metadata: input.metadata,
        requirePersistence: true,
      })
    }),

  remove: publicProcedure.input(z.object({ id: credentialIdSchema })).mutation(({ input }) => {
    return getCredentialService().remove(input.id)
  }),
})
