import { z } from "zod"
import { router, publicProcedure } from "../index"

const disabledMessage = "Hosted sandbox import is disabled in Flapstack"

export const sandboxImportRouter = router({
  importSandboxChat: publicProcedure
    .input(
      z.object({
        sandboxId: z.string(),
        remoteChatId: z.string(),
        remoteSubChatId: z.string().optional(),
        projectId: z.string(),
        chatName: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<{ chatId: string }> => {
      void input
      throw new Error(disabledMessage)
    }),

  listRemoteSandboxChats: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      void input
      return []
    }),

  cloneFromSandbox: publicProcedure
    .input(
      z.object({
        sandboxId: z.string(),
        remoteChatId: z.string(),
        remoteSubChatId: z.string().optional(),
        chatName: z.string(),
        destinationPath: z.string().optional(),
        targetPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<{ chatId: string }> => {
      void input
      throw new Error(disabledMessage)
    }),
})
