import { z } from "zod"
import { publicProcedure, router } from "../index"
import { getAppMobileBridgeService } from "../../mobile-bridge"
import { getAppMobileControlRuntime } from "../../mobile-events"
import {
  mobileActionIdSchema,
  mobileActionCatalog,
  mobileAuthorityClassSchema,
  mobileResourceRefSchema,
} from "../../../../shared/mobile-control"

const deviceId = z.string().trim().min(1).max(200)
const grantId = z.string().trim().min(1).max(200)
const grantInput = z
  .object({
    authority: z.array(mobileAuthorityClassSchema).min(1).max(4),
    capabilities: z.array(mobileActionIdSchema).min(1).max(32),
    resources: z.array(mobileResourceRefSchema).min(1).max(100),
    expiresAt: z.number().int().nonnegative().optional(),
  })
  .strict()

export const mobileBridgeRouter = router({
  getStatus: publicProcedure.query(() => getAppMobileBridgeService().getStatus()),

  listInterfaces: publicProcedure.query(() => getAppMobileBridgeService().listInterfaces()),

  configure: publicProcedure
    .input(
      z
        .object({
          enabled: z.boolean(),
          bindAddress: z.string().trim().min(1).max(128).nullable().optional(),
          port: z.number().int().min(1024).max(65_535).optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => getAppMobileBridgeService().configure(input)),

  createPairingOffer: publicProcedure.mutation(() => {
    const status = getAppMobileBridgeService().getStatus()
    if (status.state !== "running" || !status.bindAddress || !status.fingerprint)
      throw new Error("Mobile bridge must be running before creating a pairing offer.")
    const authority = status.bindAddress.includes(":")
      ? `[${status.bindAddress}]`
      : status.bindAddress
    return getAppMobileControlRuntime().pairing.createPairingOffer({
      endpoint: `https://${authority}:${status.port}`,
      certificateFingerprint: status.fingerprint,
    })
  }),

  listDevices: publicProcedure.query(() => getAppMobileControlRuntime().pairing.listDevices()),

  renameDevice: publicProcedure
    .input(z.object({ deviceId, name: z.string().trim().min(1).max(120) }).strict())
    .mutation(({ input }) =>
      getAppMobileControlRuntime().pairing.renameDevice(input.deviceId, input.name),
    ),

  revokeDevice: publicProcedure
    .input(
      z
        .object({
          deviceId,
          reason: z.enum(["user", "credential-suspected", "device-lost", "scope-replaced"]),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      await getAppMobileControlRuntime().pairing.revokeDevice(input.deviceId, input.reason)
      return { revoked: true as const }
    }),

  listGrants: publicProcedure
    .input(z.object({ deviceId: deviceId.optional() }).strict().default({}))
    .query(({ input }) => getAppMobileControlRuntime().grants.listActiveGrants(input.deviceId)),

  createGrant: publicProcedure
    .input(z.object({ deviceId, grant: grantInput }).strict())
    .mutation(({ input }) =>
      getAppMobileControlRuntime().grants.createGrant(input.deviceId, input.grant),
    ),

  replaceGrant: publicProcedure
    .input(z.object({ grantId, grant: grantInput }).strict())
    .mutation(({ input }) =>
      getAppMobileControlRuntime().grants.replaceGrant(input.grantId, input.grant),
    ),

  revokeGrant: publicProcedure.input(z.object({ grantId }).strict()).mutation(async ({ input }) => {
    await getAppMobileControlRuntime().grants.revokeGrant(input.grantId)
    return { revoked: true as const }
  }),

  listAuditRecords: publicProcedure.query(() =>
    getAppMobileControlRuntime().pairing.listAuditRecords(),
  ),

  createStepUpToken: publicProcedure
    .input(
      z
        .object({
          deviceId,
          action: mobileActionIdSchema,
          target: mobileResourceRefSchema.extend({ version: z.number().int().positive() }),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      if (mobileActionCatalog[input.action].approval !== "step-up-or-desktop")
        throw new Error("This mobile action does not use desktop step-up.")
      const device = getAppMobileControlRuntime()
        .pairing.listDevices()
        .find((candidate) => candidate.deviceId === input.deviceId && !candidate.revokedAt)
      if (!device) throw new Error("Mobile device is unavailable or revoked.")
      return getAppMobileControlRuntime().stepUp.issue({
        deviceId: input.deviceId,
        action: input.action,
        targetKind: input.target.kind,
        targetId: input.target.id,
        targetVersion: input.target.version,
        expiresAt: Date.now() + 2 * 60_000,
      })
    }),
})
