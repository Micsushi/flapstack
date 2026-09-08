import sharp from "sharp"
import { prepareDiscussionModelImage } from "../src/main/lib/discussions/images"
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
  const base64 = (
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "blue" } })
      .png()
      .toBuffer()
  ).toString("base64")
  const image = { dataUrl: `data:image/png;base64,${base64}`, width: 64, height: 64 }
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
  expect(request.mock.calls[2][1].body.images).toEqual([base64])
  expect(request.mock.calls[2][1].body.prompt).not.toContain(base64)
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

it("enlarges tiny model crops without changing the saved snapshot and rejects extreme aspect ratios", async () => {
  const snapshot = async (width: number, height: number) => ({
    width,
    height,
    dataUrl: `data:image/png;base64,${(
      await sharp({ create: { width, height, channels: 3, background: "green" } })
        .png()
        .toBuffer()
    ).toString("base64")}`,
  })
  const original = await snapshot(32, 26),
    serialized = JSON.stringify(original)
  const prepared = await prepareDiscussionModelImage(original)
  expect(Math.min(prepared.width, prepared.height)).toBe(64)
  expect(Math.max(prepared.width, prepared.height)).toBeLessThanOrEqual(768)
  expect(prepared.width / prepared.height).toBeCloseTo(32 / 26, 1)
  expect(JSON.stringify(original)).toBe(serialized)
  const pixels = await sharp(Buffer.from(prepared.dataUrl.split(",")[1]!, "base64"))
    .raw()
    .toBuffer()
  expect(
    new Set(
      Array.from({ length: pixels.length / 3 }, (_, i) =>
        pixels.subarray(i * 3, i * 3 + 3).toString("hex"),
      ),
    ),
  ).toEqual(new Set(["008000"]))
  for (const [width, height] of [
    [768, 1],
    [1, 768],
  ]) {
    const image = await snapshot(width!, height!),
      request = vi.fn()
    await expect(
      generateDiscussionResult({
        kind: "reply",
        source,
        image,
        schema: discussionReplySchema,
        env,
        request,
      }),
    ).rejects.toThrow("Select a wider or larger region")
    expect(request).not.toHaveBeenCalled()
  }
})
