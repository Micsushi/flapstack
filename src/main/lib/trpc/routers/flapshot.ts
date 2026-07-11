import { z } from "zod"
import { flapshotService } from "../../flapshot/service"
import { publicProcedure, router } from "../index"

const chatInput = z.object({ chatId: z.string().min(1) })
const operationInput = chatInput.extend({ operationId: z.string().min(1).max(128) })

export const flapshotRouter = router({
  status: publicProcedure
    .input(chatInput)
    .query(({ input }) => flapshotService.status(input.chatId)),
  captureScreenshot: publicProcedure
    .input(chatInput)
    .mutation(({ input }) => flapshotService.captureScreenshot(input.chatId)),
  startRecording: publicProcedure
    .input(chatInput)
    .mutation(({ input }) => flapshotService.startRecording(input.chatId)),
  stopRecording: publicProcedure
    .input(operationInput)
    .mutation(({ input }) => flapshotService.stopRecording(input.chatId, input.operationId)),
  cancelOperation: publicProcedure
    .input(operationInput)
    .mutation(({ input }) => flapshotService.cancelOperation(input.chatId, input.operationId)),
  restart: publicProcedure
    .input(chatInput)
    .mutation(({ input }) => flapshotService.restart(input.chatId)),
  listOperations: publicProcedure
    .input(chatInput)
    .query(({ input }) => flapshotService.listOperations(input.chatId)),
  verifyAttachment: publicProcedure
    .input(chatInput.extend({ attachmentId: z.string().min(1) }))
    .mutation(({ input }) => flapshotService.verifyAttachment(input.chatId, input.attachmentId)),
})
