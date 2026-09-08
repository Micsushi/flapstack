import { expect, it, vi } from "vitest"
import { generateDiscussionResult } from "../src/main/lib/discussions/assistant"
import {
  discussionReplySchema,
  discussionOutputFormats,
} from "../src/main/lib/discussions/assistant-policy"

const env = {
  FLAPSTACK_DISCUSSION_OLLAMA_URL: "http://127.0.0.1:11435",
  FLAPSTACK_DISCUSSION_MODEL: "local-small",
}
const source = { quote: "A saved source", question: "What changed?" }
it("uses the installed local model with no tools or cloud fallback", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ models: [{ name: "local-small" }] })
    .mockResolvedValueOnce({ response: '{"reply":"The source is saved."}', done: true })
  expect(
    await generateDiscussionResult({
      kind: "reply",
      source,
      schema: discussionReplySchema,
      env,
      request,
    }),
  ).toEqual({ result: { reply: "The source is saved." }, model: "local-small" })
  expect(request.mock.calls[1][1]).toMatchObject({
    baseUrl: env.FLAPSTACK_DISCUSSION_OLLAMA_URL,
    body: {
      model: "local-small",
      keep_alive: 0,
      stream: false,
      format: discussionOutputFormats.reply,
    },
  })
  expect(request.mock.calls[1][1].body).not.toHaveProperty("tools")
})
it("preserves source on absent model, invalid generation and excess context", async () => {
  const request = vi.fn().mockResolvedValue({ models: [] })
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source,
      schema: discussionReplySchema,
      env,
      request,
    }),
  ).rejects.toThrow("No local discussion model")
  request
    .mockResolvedValueOnce({ models: [{ name: "local-small" }] })
    .mockResolvedValueOnce({ response: '{"reply":"","execution":"done"}' })
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source,
      schema: discussionReplySchema,
      env,
      request,
    }),
  ).rejects.toThrow("draft are kept")
  request.mockClear()
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source: "x".repeat(16_001),
      schema: discussionReplySchema,
      env,
      request,
    }),
  ).rejects.toThrow("too long")
  expect(request).not.toHaveBeenCalled()
})
it("refuses concurrent generation without leaking response contents", async () => {
  let release!: (value: unknown) => void
  const request = vi
    .fn()
    .mockResolvedValueOnce({ models: [{ name: "local-small" }] })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
  const first = generateDiscussionResult({
    kind: "reply",
    source,
    schema: discussionReplySchema,
    env,
    request,
  })
  await vi.waitFor(() => expect(release).toBeTypeOf("function"))
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source,
      schema: discussionReplySchema,
      env,
      request,
    }),
  ).rejects.toThrow("already running")
  release({ response: "private invalid text" })
  await expect(first).rejects.toThrow("could not be completed")
})

it("requires installed vision capability and sends one bounded image outside the prompt", async () => {
  const image = { dataUrl: "data:image/png;base64,cGl4ZWxz", width: 2, height: 2 }
  const visionEnv = { ...env, FLAPSTACK_DISCUSSION_VISION_MODEL: "local-vision" }
  const request = vi
    .fn()
    .mockResolvedValueOnce({ models: [{ name: "local-vision" }] })
    .mockResolvedValueOnce({ capabilities: ["completion", "vision"] })
    .mockResolvedValueOnce({ response: '{"reply":"A crop."}', done: true })
  await generateDiscussionResult({
    kind: "reply",
    source,
    image,
    schema: discussionReplySchema,
    env: visionEnv,
    request,
  })
  expect(request.mock.calls.map((call) => call[0])).toEqual([
    "/api/tags",
    "/api/show",
    "/api/generate",
  ])
  expect(request.mock.calls[2][1].body.images).toEqual(["cGl4ZWxz"])
  expect(request.mock.calls[2][1].body.prompt).not.toContain("cGl4ZWxz")
  expect(request.mock.calls[2][1].body.prompt).toContain("image_available:\ntrue")
  const noVision = vi
    .fn()
    .mockResolvedValueOnce({ models: [{ name: "local-vision" }] })
    .mockResolvedValueOnce({ capabilities: ["completion"] })
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source,
      image,
      schema: discussionReplySchema,
      env: visionEnv,
      request: noVision,
    }),
  ).rejects.toThrow("vision capability")
  expect(noVision).toHaveBeenCalledTimes(2)
  const invalid = vi.fn()
  await expect(
    generateDiscussionResult({
      kind: "reply",
      source,
      image: { ...image, dataUrl: "https://example.com/a.png" },
      schema: discussionReplySchema,
      env: visionEnv,
      request: invalid,
    }),
  ).rejects.toThrow("Invalid discussion image")
  expect(invalid).not.toHaveBeenCalled()
})
