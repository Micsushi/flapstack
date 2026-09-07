import { z } from "zod"
import {
  buildChatMetadataPrompt,
  parseGeneratedChatMetadata,
  singleTokenChatTitle,
  type ChatTitleStyle,
  type GeneratedChatMetadata,
} from "../../../shared/chat-metadata"
import { checkOllamaStatus } from "./detector"
import { requestOllamaJson } from "./request-json"

const responseSchema = z.object({ response: z.string().max(64 * 1024) })

/** Never consumes the active chat provider's context or quota. */
export async function generateChatMetadataWithOllama(input: {
  userMessage: string
  titleStyle: ChatTitleStyle
  includeTags: boolean
  model?: string | null
}): Promise<GeneratedChatMetadata | null> {
  try {
    const status = await checkOllamaStatus()
    if (!status.available) return null
    const model = input.model || status.recommendedModel || status.models[0]
    if (!model) return null
    const data = responseSchema.safeParse(
      await requestOllamaJson("/api/generate", {
        timeoutMs: 30_000,
        maxBytes: 256 * 1024,
        body: {
          model,
          prompt: buildChatMetadataPrompt(input),
          format: "json",
          stream: false,
          options: { temperature: 0.2, num_predict: 180 },
        },
      }),
    )
    const metadata = data.success
      ? parseGeneratedChatMetadata(data.data.response, input.titleStyle)
      : null
    return metadata
      ? { ...metadata, title: singleTokenChatTitle(input.userMessage) ?? metadata.title }
      : null
  } catch {
    // The caller retains its local fallback; never log message/model response contents.
    return null
  }
}
