import { z } from "zod"
import { publicProcedure, router } from "../index"
import { mobilePairingOfferSchema } from "../../../../shared/mobile-control"
import { RemoteComputerClient } from "../../mobile-client/service"
import { RemoteIdentityStore } from "../../mobile-client/identity"

let instance: RemoteComputerClient | undefined
const client = () => (instance ??= new RemoteComputerClient(new RemoteIdentityStore()))
export const mobileClientRouter = router({
  status: publicProcedure.query(() => client().status()),
  pair: publicProcedure
    .input(
      z
        .object({
          offer: mobilePairingOfferSchema,
          label: z.string().trim().min(1).max(120),
          confirmedEndpoint: z.string().max(2048),
          confirmedFingerprint: z.string().max(80),
        })
        .strict(),
    )
    .mutation(({ input }) => client().pair(input)),
  connect: publicProcedure
    .input(z.object({ grantId: z.string().trim().min(1).max(200) }).strict())
    .mutation(({ input }) => client().connect(input.grantId)),
  disconnect: publicProcedure.mutation(() => client().disconnect()),
  answer: publicProcedure
    .input(
      z
        .object({
          connectionId: z.string().uuid(),
          targetId: z.string().min(1).max(200),
          targetVersion: z.number().int().positive(),
          scopeVersion: z.number().int().positive(),
          answers: z.record(z.array(z.string().trim().min(1).max(4000)).min(1).max(13)),
          confirmed: z.literal(true),
        })
        .strict(),
    )
    .mutation(({ input }) => client().answer(input)),
})
