import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildCursorPermissionApplication,
  mapCursorPermissionFlags,
} from "../src/main/lib/permissions"
import {
  CursorStreamTranslator,
  isCursorAuthText,
  parseCursorStreamLine,
  type CursorAssistantPart,
} from "../src/main/lib/cursor/stream"
import { normalizeCursorStatus, parseCursorModels } from "../src/main/lib/cursor/integration"
import { CursorCliTimeoutError, runCursorCli } from "../src/main/lib/cursor/binary"
import { buildCursorArgs } from "../src/main/lib/cursor/args"
import {
  CURSOR_MODELS,
  DEFAULT_CURSOR_MODEL_ID,
  formatCursorModelForCli,
  formatModelDisplayName,
} from "../src/shared/model-catalog"
import { AGENT_HARNESSES } from "../src/shared/harness-types"

const FIXTURE_DIR = join(__dirname, "fixtures", "cursor-agent")

function runFixture(file: string): {
  chunks: any[]
  parts: CursorAssistantPart[]
  metadata: ReturnType<CursorStreamTranslator["getMetadata"]>
} {
  const raw = readFileSync(join(FIXTURE_DIR, file), "utf8")
  const translator = new CursorStreamTranslator()
  const chunks: any[] = []
  for (const line of raw.split("\n")) {
    const event = parseCursorStreamLine(line)
    if (event) chunks.push(...translator.push(event))
  }
  chunks.push(...translator.finish())
  return { chunks, parts: translator.getParts(), metadata: translator.getMetadata() }
}

describe("cursor harness contract (D1)", () => {
  it("registers cursor-agent as a first-class harness", () => {
    expect(AGENT_HARNESSES).toContain("cursor-agent")
  })

  it("keeps auto as the default model and labels catalog ids", () => {
    expect(DEFAULT_CURSOR_MODEL_ID).toBe("auto")
    expect(CURSOR_MODELS.some((m) => m.id === "auto")).toBe(true)
    expect(formatModelDisplayName("auto")).toBe("Auto")
  })

  it("formats the --model CLI arg with cursor bracket effort syntax", () => {
    expect(formatCursorModelForCli("auto")).toBe("auto")
    expect(formatCursorModelForCli("claude-opus-4-8")).toBe("claude-opus-4-8")
    expect(formatCursorModelForCli("claude-opus-4-8", "high")).toBe("claude-opus-4-8[effort=high]")
    // Pre-bracketed ids pass through untouched.
    expect(formatCursorModelForCli("gpt-5.5[context=1m]", "low")).toBe("gpt-5.5[context=1m]")
  })

  it("passes the workspace trust flag required for non-interactive runs", () => {
    expect(
      buildCursorArgs({ model: "auto", cwd: "/tmp/project", permissionMode: "read-only" }),
    ).toContain("--trust")
  })
})

describe("cursor stream translator (D2)", () => {
  it("renders reasoning output + streamed assistant text and captures usage", () => {
    const { chunks, parts, metadata } = runFixture("reasoning-output-run.jsonl")

    const reasoningDeltas = chunks.filter((c) => c.type === "reasoning-delta")
    expect(reasoningDeltas.length).toBeGreaterThan(0)
    expect(chunks.filter((c) => c.type === "reasoning-start")).toHaveLength(1)
    expect(chunks.filter((c) => c.type === "reasoning-end")).toHaveLength(1)

    const textDeltas = chunks.filter((c) => c.type === "text-delta")
    expect(textDeltas.map((c) => c.delta).join("")).toBe("Hello! How can I help you today?")

    const textPart = parts.find((p) => p.type === "text") as { text: string } | undefined
    expect(textPart?.text).toBe("Hello! How can I help you today?")
    const reasoningPart = parts.find((p) => p.type === "reasoning") as { text: string } | undefined
    expect(reasoningPart?.text).toContain("one sentence")

    expect(metadata.sessionId).toBe("c0ffee00-cafe-4bad-babe-cursor000001")
    expect(metadata.totalTokens).toBe(51)
    expect(metadata.resultSubtype).toBe("success")
  })

  it("uses the shared Cursor normalizer for partial reasoning-output envelopes", () => {
    const translator = new CursorStreamTranslator()
    const chunks = translator.push({
      type: "thinking",
      delta: { text: "Checking the partial-output shape." },
    })

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "reasoning-delta",
        delta: "Checking the partial-output shape.",
      }),
    )
  })

  it("preserves reasoning from a completed-only event", () => {
    const translator = new CursorStreamTranslator()
    const chunks = translator.push({
      type: "thinking",
      subtype: "completed",
      text: "Completed reasoning output.",
    })

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
    ])
    expect(translator.getParts()).toContainEqual({
      type: "reasoning",
      text: "Completed reasoning output.",
      state: "done",
    })
  })

  it("does not duplicate a completed reasoning event after streamed deltas", () => {
    const translator = new CursorStreamTranslator()
    translator.push({ type: "thinking", subtype: "delta", text: "Streamed reasoning." })
    translator.push({ type: "assistant", delta: { text: "Answer" } })

    expect(
      translator.push({
        type: "thinking",
        subtype: "completed",
        text: "Streamed reasoning.",
      }),
    ).toEqual([])
    expect(translator.getParts().filter((part) => part.type === "reasoning")).toHaveLength(1)
  })

  it("preserves a second id-less completed-only reasoning block", () => {
    const translator = new CursorStreamTranslator()
    translator.push({ type: "thinking", subtype: "delta", text: "First block." })
    translator.push({ type: "thinking", subtype: "completed", text: "First block." })

    expect(
      translator.push({
        type: "thinking",
        subtype: "completed",
        text: "Second block.",
      }),
    ).toEqual([
      expect.objectContaining({ type: "reasoning-start" }),
      expect.objectContaining({ type: "reasoning-delta", delta: "Second block." }),
      expect.objectContaining({ type: "reasoning-end" }),
    ])
    expect(translator.getParts().filter((part) => part.type === "reasoning")).toMatchObject([
      { text: "First block." },
      { text: "Second block." },
    ])
  })

  it("produces a complete reply when reasoning output is suppressed", () => {
    const { chunks, parts } = runFixture("no-reasoning-output-run.jsonl")
    expect(chunks.some((c) => c.type === "reasoning-delta")).toBe(false)
    const textPart = parts.find((p) => p.type === "text") as { text: string } | undefined
    expect(textPart?.text).toBe("Hello! How can I help you today?")
  })

  it("captures camelCase usage from the current Cursor CLI", () => {
    const translator = new CursorStreamTranslator()
    translator.push({
      type: "result",
      subtype: "success",
      usage: { inputTokens: 17, outputTokens: 3, totalTokens: 20 },
    })

    expect(translator.getMetadata()).toMatchObject({
      inputTokens: 17,
      outputTokens: 3,
      totalTokens: 20,
    })
  })

  it("tolerates blank and malformed lines", () => {
    expect(parseCursorStreamLine("")).toBeNull()
    expect(parseCursorStreamLine("   ")).toBeNull()
    expect(parseCursorStreamLine("{not json")).toBeNull()
    expect(parseCursorStreamLine('{"type":"system"}')).toEqual({ type: "system" })
  })

  it("flags auth errors from the stream", () => {
    const translator = new CursorStreamTranslator()
    const chunks = translator.push({
      type: "error",
      message: "Not logged in. Run cursor-agent login.",
    })
    expect(chunks[0]).toMatchObject({ type: "auth-error" })
    expect(translator.sawAuthError()).toBe(true)
    expect(isCursorAuthText("unauthorized")).toBe(true)
    expect(isCursorAuthText("1403 files changed")).toBe(false)
    expect(isCursorAuthText("forbidden-pattern.txt")).toBe(false)
    expect(isCursorAuthText("all good")).toBe(false)
  })

  it("flags structured failures even when process exit status could be zero", () => {
    const errorEvent = new CursorStreamTranslator()
    errorEvent.push({ type: "error", message: "Provider rejected the request" })
    expect(errorEvent.sawError()).toBe(true)

    const errorResult = new CursorStreamTranslator()
    const chunks = errorResult.push({ type: "result", subtype: "error", result: "Request failed" })
    expect(errorResult.sawError()).toBe(true)
    expect(chunks).toContainEqual({ type: "error", errorText: "Request failed" })
    expect(errorResult.getParts()).toEqual([])
  })

  it("does not duplicate cumulative text after a tool call", () => {
    const translator = new CursorStreamTranslator()
    translator.push({ type: "assistant", message: { text: "Alpha" } })
    translator.push({
      type: "tool_call",
      subtype: "started",
      call_id: "tool",
      name: "bash",
      input: {},
    })
    translator.push({ type: "assistant", message: { text: "Alpha Beta" } })
    translator.finish()
    const text = translator
      .getParts()
      .filter(
        (part): part is Extract<CursorAssistantPart, { type: "text" }> => part.type === "text",
      )
      .map((part) => part.text)
      .join("")
    expect(text).toBe("Alpha Beta")
  })

  it("preserves identical explicit incremental deltas", () => {
    const translator = new CursorStreamTranslator()
    translator.push({ type: "assistant", delta: { text: "ha" } })
    translator.push({ type: "assistant", delta: { text: "ha" } })
    translator.finish()
    const text = translator
      .getParts()
      .filter(
        (part): part is Extract<CursorAssistantPart, { type: "text" }> => part.type === "text",
      )
      .map((part) => part.text)
      .join("")
    expect(text).toBe("haha")
  })
})

describe("cursor permission mapping (D4)", () => {
  it("maps read-only to plan + sandbox, no auto-approve", () => {
    const flags = mapCursorPermissionFlags("read-only")
    expect(flags).toMatchObject({ mode: "plan", sandbox: "enabled", force: false })

    const application = buildCursorPermissionApplication({
      permissionMode: "read-only",
      cwd: "/tmp/project",
    })
    expect(application.requested).toBe("read-only")
    expect(application.applied).toBe(true)
    expect(
      application.enforced.some((e) => e.control === "cursor-mode" && e.value === "plan"),
    ).toBe(true)
  })

  it("maps full-access to force + sandbox disabled with no limitations", () => {
    const flags = mapCursorPermissionFlags("full-access")
    expect(flags).toMatchObject({ force: true, sandbox: "disabled" })
    const application = buildCursorPermissionApplication({
      permissionMode: "full-access",
      cwd: null,
    })
    expect(application.limitations).toHaveLength(0)
  })

  it("records honest limitations for ask-before-edits", () => {
    const application = buildCursorPermissionApplication({
      permissionMode: "ask-before-edits",
      cwd: "/tmp/project",
    })
    expect(application.degraded).toBe(true)
    expect(application.limitations.length).toBeGreaterThan(0)
  })
})

describe("cursor integration status (D3)", () => {
  it("parses connected/not-logged-in states", () => {
    expect(normalizeCursorStatus("Logged in as developer@example.com")).toEqual({
      state: "connected",
      email: "developer@example.com",
    })
    expect(normalizeCursorStatus("Not logged in").state).toBe("not_logged_in")
    expect(normalizeCursorStatus("Unauthenticated").state).toBe("not_logged_in")
    expect(normalizeCursorStatus("weird output").state).toBe("unknown")
  })

  it("returns executable ids rather than CLI model display lines", () => {
    expect(
      parseCursorModels(
        "Models:\nModels\nAvailable models\nauto - Auto\ngpt-5.3-codex - Codex 5.3\nauto - Auto\n",
      ),
    ).toEqual(["auto", "gpt-5.3-codex"])
  })

  it("reports a short-lived CLI deadline as a timeout", async () => {
    const previous = process.env.FLAPSTACK_CURSOR_AGENT_PATH
    process.env.FLAPSTACK_CURSOR_AGENT_PATH = process.execPath
    try {
      const startedAt = Date.now()
      await expect(
        runCursorCli(["-e", "setTimeout(() => {}, 10_000)"], { timeoutMs: 20 }),
      ).rejects.toBeInstanceOf(CursorCliTimeoutError)
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      if (previous === undefined) delete process.env.FLAPSTACK_CURSOR_AGENT_PATH
      else process.env.FLAPSTACK_CURSOR_AGENT_PATH = previous
    }
  })
})
