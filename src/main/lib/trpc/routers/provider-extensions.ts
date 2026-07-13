import { z } from "zod"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  providerExtensionMutationSchema,
} from "../../provider-extensions"
import { publicProcedure, router } from "../index"

export const providerExtensionsRouter = router({
  list: publicProcedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(({ input }) => discoverProviderExtensions({ cwd: input?.cwd })),

  mutate: publicProcedure.input(providerExtensionMutationSchema).mutation(({ input }) => {
    return mutateProviderExtension(input)
  }),
})
