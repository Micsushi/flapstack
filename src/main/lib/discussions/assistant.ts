import type { DiscussionImageSnapshot } from "../../../shared/discussions"
import { discussionImageLimits } from "./images"
import { z } from "zod"
import { getOllamaEndpointConfig } from "../harness/local-model-catalog"
import { requestOllamaJson } from "../ollama/request-json"
import { discussionAssistantPrompt } from "./assistant-prompts"
import { DISCUSSION_ASSISTANT_POLICY as policy, discussionOutputFormats } from "./assistant-policy"

type LocalRequest = typeof requestOllamaJson
const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string().min(1).max(512) })).max(1000),
})
const responseSchema = z.object({
  response: z.string().max(policy.maxResponseBytes),
  done: z.boolean().optional(),
})
let busy = false

/** No tools, cloud fallback, chat append, or execution side effects. One bounded local call. */
export async function generateDiscussionResult<T>(input: {
  kind: "summary" | "reply" | "capture" | "capture-review"
  source: unknown
  image?: DiscussionImageSnapshot
  schema: z.ZodType<T>
  request?: LocalRequest
  env?: NodeJS.ProcessEnv
}): Promise<{ result: T; model: string }> {
  if (busy)
    throw new Error("A local discussion reply is already running. Try again when it finishes.")
  if (JSON.stringify(input.source).length > policy.maxContextCharacters) {
    throw new Error("This discussion is too long for the local reply. Select a smaller source.")
  }
  if (
    input.image &&
    (input.kind !== "reply" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.image.dataUrl) ||
      input.image.dataUrl.length > Math.ceil(discussionImageLimits.outputBytes / 3) * 4 + 22 ||
      !Number.isInteger(input.image.width) ||
      !Number.isInteger(input.image.height) ||
      input.image.width < 1 ||
      input.image.height < 1 ||
      input.image.width > discussionImageLimits.edge ||
      input.image.height > discussionImageLimits.edge)
  )
    throw new Error("Invalid discussion image snapshot")
  const env = input.env ?? process.env
  const config = getOllamaEndpointConfig({
    baseUrl: env.FLAPSTACK_DISCUSSION_OLLAMA_URL || env.FLAPSTACK_OLLAMA_BASE_URL,
  })
  const request = input.request ?? requestOllamaJson
  busy = true
  try {
    const tags = tagsSchema.parse(
      await request("/api/tags", {
        timeoutMs: 2000,
        maxBytes: 512 * 1024,
        baseUrl: config.baseUrl,
      }),
    )
    const configuredModel = (
      input.image ? env.FLAPSTACK_DISCUSSION_VISION_MODEL : env.FLAPSTACK_DISCUSSION_MODEL
    )?.trim()
    const model =
      configuredModel ||
      (!input.image &&
        tags.models.find((item) => !/embed|bert|rerank|cloud/i.test(item.name))?.name)
    if (!model || /cloud/i.test(model) || !tags.models.some((item) => item.name === model)) {
      throw new Error(
        "No local discussion model is available. Select an installed Ollama chat model.",
      )
    }
    if (input.image) {
      const details = z
        .object({ capabilities: z.array(z.string()).max(100) })
        .parse(
          await request("/api/show", {
            timeoutMs: 2000,
            maxBytes: 512 * 1024,
            baseUrl: config.baseUrl,
            body: { model },
          }),
        )
      if (!details.capabilities.includes("vision"))
        throw new Error("No local discussion model with vision capability is configured.")
    }
    const response = responseSchema.parse(
      await request("/api/generate", {
        timeoutMs: policy.timeoutMs,
        maxBytes: policy.maxResponseBytes,
        baseUrl: config.baseUrl,
        body: {
          model,
          prompt: discussionAssistantPrompt(input.kind, input.source, Boolean(input.image)),
          ...(input.image
            ? { images: [input.image.dataUrl.slice("data:image/png;base64,".length)] }
            : {}),
          format: discussionOutputFormats[input.kind],
          stream: false,
          keep_alive: 0,
          options: {
            temperature: 0,
            num_ctx: policy.contextTokens,
            num_predict: policy.outputTokens,
          },
        },
      }),
    )
    if (response.done === false) throw new Error("Incomplete model response")
    const parsed = input.schema.safeParse(JSON.parse(response.response))
    if (!parsed.success) throw new Error("Invalid model response")
    return { result: parsed.data, model }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No local discussion model")) throw error
    throw new Error(
      "The local discussion reply could not be completed. Your source and draft are kept; retry or open the main discussion.",
    )
  } finally {
    busy = false
  }
}
