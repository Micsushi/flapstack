import { describe, expect, it } from "vitest"
import {
  latestAssistantUsesDirectRuntime,
  RuntimeResponseLabelFilter,
  RuntimeTextChatChunkMapper,
} from "../src/renderer/features/agents/lib/runtime-text-chat-chunks"
import { directRuntimeFinishMetadata } from "../src/renderer/features/agents/lib/runtime-finish-metadata"

describe("direct runtime chat transport", () => {
  it("persists the measured Runtime duration for the Worked for label", () => {
    expect(
      directRuntimeFinishMetadata({
        runId: "run",
        harness: "codex",
        startedAtMs: 1_000,
        durationMs: 22_000,
      }),
    ).toEqual({
      runId: "run",
      transport: "codex-runtime",
      startedAt: 1_000,
      durationMs: 22_000,
    })
  })

  it("persists native context usage with the assistant reply", () => {
    expect(
      directRuntimeFinishMetadata({
        runId: "run",
        harness: "claude-code",
        startedAtMs: 1_000,
        durationMs: 22_000,
        usage: {
          inputTokens: 2,
          outputTokens: 110,
          cachedTokens: 22_077,
          reasoningTokens: 100,
          contextWindow: 200_000,
        },
      }),
    ).toMatchObject({
      inputTokens: 2,
      outputTokens: 110,
      totalTokens: 22_189,
      cacheReadInputTokens: 22_077,
      reasoningTokens: 100,
      modelContextWindow: 200_000,
    })
  })

  it("persists only when the latest assistant reply came from a direct Runtime", () => {
    const oldDirect = {
      role: "assistant",
      metadata: { transport: "codex-runtime" },
      parts: [{ type: "text", text: "Old" }],
    }
    expect(
      latestAssistantUsesDirectRuntime([
        oldDirect,
        { role: "user", parts: [{ type: "text", text: "Next" }] },
        { role: "assistant", metadata: { transport: "codex" }, parts: [] },
      ]),
    ).toBe(false)
    expect(latestAssistantUsesDirectRuntime([oldDirect])).toBe(true)
  })

  it("keeps commentary, tools, and final text as ordered separate parts", () => {
    const mapper = new RuntimeTextChatChunkMapper("run")
    const commentary = {
      providerItemId: "commentary-1",
      providerMessageId: "message-1",
      contentIndex: 0,
      sectionBoundary: null,
    }
    const final = {
      providerItemId: "final-1",
      providerMessageId: "message-1",
      contentIndex: 1,
      sectionBoundary: null,
    }

    const chunks = [
      ...mapper.map({ ...commentary, phase: "started" as const, text: "" }),
      ...mapper.map({ ...commentary, phase: "delta" as const, text: "Checking files." }),
      ...mapper.beforeActivity(),
      ...mapper.map({ ...final, phase: "completed" as const, text: "Fixed." }),
    ]

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "text-start",
      "text-delta",
      "text-end",
    ])
    expect(
      chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta),
    ).toEqual(["Checking files.", "Fixed."])
  })

  it("does not append the completed snapshot after streamed deltas", () => {
    const mapper = new RuntimeTextChatChunkMapper("run")
    const identity = {
      providerItemId: "message-1",
      providerMessageId: "message-1",
      contentIndex: 0,
      sectionBoundary: null,
    }
    const chunks = [
      ...mapper.map({ ...identity, phase: "delta" as const, text: "Hello" }),
      ...mapper.map({ ...identity, phase: "completed" as const, text: "Hello world" }),
    ]

    expect(
      chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta),
    ).toEqual(["Hello"])
  })

  it("uses one Codex text part when only the snapshot has a section label", () => {
    const mapper = new RuntimeTextChatChunkMapper("run")
    const base = {
      providerItemId: "message-1",
      providerMessageId: null,
      contentIndex: null,
    }
    const chunks = [
      ...mapper.map({
        ...base,
        phase: "started" as const,
        text: "",
        sectionBoundary: "commentary",
      }),
      ...mapper.map({ ...base, phase: "delta" as const, text: "Working", sectionBoundary: null }),
      ...mapper.map({
        ...base,
        phase: "completed" as const,
        text: "Working",
        sectionBoundary: "commentary",
      }),
    ]

    expect(chunks.map((chunk) => chunk.type)).toEqual(["text-start", "text-delta", "text-end"])
  })

  it("removes leaked Hotline section labels across stream boundaries", () => {
    const filter = new RuntimeResponseLabelFilter(true)
    const output = [
      filter.push("Spo"),
      filter.push("ken: Hello\nDis"),
      filter.push("played:\nDetails"),
      filter.flush(),
    ].join("")

    expect(output).toBe("Hello\n\nDetails")
    expect(output).not.toContain("Spoken:")
    expect(output).not.toContain("Displayed:")
  })

  it("resets Hotline label filtering between commentary and final text parts", () => {
    const mapper = new RuntimeTextChatChunkMapper("run", new RuntimeResponseLabelFilter(true))
    const chunks = [
      ...mapper.map({
        phase: "completed" as const,
        text: "Working",
        providerItemId: "commentary",
        providerMessageId: "message",
        contentIndex: 0,
        sectionBoundary: "commentary",
      }),
      ...mapper.map({
        phase: "completed" as const,
        text: "Spoken: Fixed",
        providerItemId: "final",
        providerMessageId: "message",
        contentIndex: 1,
        sectionBoundary: "final",
      }),
    ]

    expect(
      chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta),
    ).toEqual(["Working", "Fixed"])
  })
})
