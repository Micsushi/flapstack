import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  OPENCODE_PROVIDERS,
  OPENCODE_SEED_MODELS,
  parseOpencodeModelString,
  toOpencodeModelString,
} from "../src/main/lib/harness/opencode-sidecar/catalog"
import {
  buildOpencodePermissionApplication,
  buildOpencodePermissionConfig,
  buildOpencodeSessionPermissions,
  classifyPermission,
  decideAutoApproval,
} from "../src/main/lib/harness/opencode-sidecar/permissions"
import {
  eventSessionId,
  normalizeOpencodeEvent,
  OpencodeEventNormalizer,
  parseSseChunk,
} from "../src/main/lib/harness/opencode-sidecar/events"
import { SidecarChunkMapper } from "../src/main/lib/harness/opencode-sidecar/chunks"
import { resolveOpencodeBinary } from "../src/main/lib/harness/opencode-sidecar/binary"
import { OpencodeClient } from "../src/main/lib/harness/opencode-sidecar/client"
import { buildOpencodeConfig } from "../src/main/lib/harness/opencode-sidecar/config"
import {
  clearProviderKey,
  getCredentialStatus,
  getProviderKey,
  hasProviderKey,
  setProviderKey,
} from "../src/main/lib/harness/opencode-sidecar/credentials"
import {
  getAvailableProviderModels,
  refreshProviderModels,
} from "../src/main/lib/harness/opencode-sidecar/models"
import { startSidecar } from "../src/main/lib/harness/opencode-sidecar/launcher"
import { runSidecarSession } from "../src/main/lib/harness/opencode-sidecar/session"
import { isOpencodeHarness, OPENCODE_HARNESSES } from "../src/shared/harness-types"

describe("harness identity", () => {
  it("recognizes OpenCode-backed providers", () => {
    expect([...OPENCODE_HARNESSES]).toEqual(["openrouter", "nanogpt"])
    expect(isOpencodeHarness("openrouter")).toBe(true)
    expect(isOpencodeHarness("nanogpt")).toBe(true)
    expect(isOpencodeHarness("codex")).toBe(false)
    expect(isOpencodeHarness(null)).toBe(false)
  })
})

describe("catalog", () => {
  it("has both providers with distinct chips", () => {
    expect(OPENCODE_PROVIDERS.openrouter.chip).toBe("purple")
    expect(OPENCODE_PROVIDERS.nanogpt.chip).toBe("rose")
  })

  it("round-trips model strings", () => {
    const s = toOpencodeModelString("openrouter", "anthropic/claude-opus-4-8")
    expect(s).toBe("openrouter/anthropic/claude-opus-4-8")
    expect(parseOpencodeModelString(s)).toEqual({
      providerId: "openrouter",
      modelId: "anthropic/claude-opus-4-8",
    })
  })

  it("ships seed models for both providers", () => {
    expect(OPENCODE_SEED_MODELS.openrouter.length).toBeGreaterThan(0)
    expect(OPENCODE_SEED_MODELS.nanogpt.length).toBeGreaterThan(0)
  })
})

describe("permission mapping", () => {
  it("read-only denies all mutating tools", () => {
    expect(buildOpencodePermissionConfig("read-only")).toEqual({
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
    })
  })

  it("full-access allows all", () => {
    expect(buildOpencodePermissionConfig("full-access")).toEqual({
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
    })
  })

  it("serializes the mode as the OpenCode session ruleset", () => {
    expect(buildOpencodeSessionPermissions("read-only")).toEqual([
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "write", pattern: "*", action: "deny" },
      { permission: "apply_patch", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "webfetch", pattern: "*", action: "deny" },
      { permission: "websearch", pattern: "*", action: "deny" },
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ])
  })

  it("auto-edit-project-only allows edits but asks for shell", () => {
    const rules = buildOpencodePermissionConfig("auto-edit-project-only")
    expect(rules.edit).toBe("allow")
    expect(rules.bash).toBe("ask")
  })

  it("classifies permission strings", () => {
    expect(classifyPermission("edit_file")).toBe("edit")
    expect(classifyPermission("bash")).toBe("bash")
    expect(classifyPermission("webfetch")).toBe("webfetch")
  })

  it("auto-decides unambiguous modes and defers ambiguous ones", () => {
    expect(decideAutoApproval("read-only", "edit")).toEqual({
      reply: "reject",
      message: expect.stringContaining("read-only"),
    })
    expect(decideAutoApproval("full-access", "bash")).toEqual({ reply: "once" })
    // ask-before-edits on an editing tool must route to the user (null).
    expect(decideAutoApproval("ask-before-edits", "edit")).toBeNull()
  })

  it("surfaces honest limitations without claiming false enforcement", () => {
    const app = buildOpencodePermissionApplication({ permissionMode: "read-only", cwd: "/repo" })
    expect(app.requested).toBe("read-only")
    expect(app.limitations.some((l) => l.control === "mcp")).toBe(true)
    const full = buildOpencodePermissionApplication({ permissionMode: "full-access", cwd: "/repo" })
    expect(full.limitations).toHaveLength(0)
    expect(full.degraded).toBe(false)
  })
})

describe("SSE parsing", () => {
  it("frames complete events and buffers partials", () => {
    const first = parseSseChunk("", 'id: 1\nevent: message\ndata: {"a":1}\n\ndata: {"b"')
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({ id: "1", data: '{"a":1}' })
    const second = parseSseChunk(first.buffer, ":2}\n\n")
    expect(second.events[0].data).toBe('{"b":2}')
  })

  it("ignores comment lines", () => {
    const { events } = parseSseChunk("", ": keepalive\ndata: x\n\n")
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe("x")
  })
})

describe("event normalization", () => {
  it("extracts session id across shapes", () => {
    expect(
      eventSessionId({ type: "message.updated", properties: { info: { sessionID: "s1" } } }),
    ).toBe("s1")
    expect(eventSessionId({ type: "session.idle", properties: { sessionID: "s2" } })).toBe("s2")
  })

  it("maps text and reasoning deltas", () => {
    const events = normalizeOpencodeEvent({
      type: "message.part.delta",
      properties: { part: { type: "text", id: "p1", text: "hello", sessionID: "s" } },
    })
    expect(events).toContainEqual({ kind: "text-delta", partId: "p1", delta: "hello" })

    const reasoning = normalizeOpencodeEvent({
      type: "message.part.delta",
      properties: { part: { id: "p2", reasoning: "thinking...", sessionID: "s" } },
    })
    expect(reasoning).toContainEqual({
      kind: "reasoning-delta",
      partId: "p2",
      delta: "thinking...",
    })
  })

  it("handles OpenCode's compact delta shape without duplicating part updates", () => {
    const normalizer = new OpencodeEventNormalizer()
    normalizer.normalize({
      type: "message.part.updated",
      properties: { part: { id: "r1", type: "reasoning", text: "", sessionID: "s" } },
    })
    expect(
      normalizer.normalize({
        type: "message.part.delta",
        properties: { sessionID: "s", partID: "r1", field: "text", delta: "think" },
      }),
    ).toContainEqual({ kind: "reasoning-delta", partId: "r1", delta: "think" })
    expect(
      normalizer.normalize({
        type: "message.part.updated",
        properties: { part: { id: "r1", type: "reasoning", text: "think", sessionID: "s" } },
      }),
    ).toEqual([])
  })

  it("maps tool inputs, output, and errors from part updates", () => {
    const running = normalizeOpencodeEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: { status: "running", input: { command: "pwd" } },
        },
      },
    })
    expect(running).toContainEqual({
      kind: "tool-input-start",
      toolCallId: "call-1",
      toolName: "bash",
    })
    expect(running).toContainEqual({
      kind: "tool-input-available",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "pwd" },
    })
    expect(
      normalizeOpencodeEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool-part",
            type: "tool",
            callID: "call-1",
            state: { status: "error", error: "no" },
          },
        },
      }),
    ).toContainEqual({ kind: "tool-error", toolCallId: "call-1", errorText: "no" })
  })

  it("normalizes legacy reasoning_content", () => {
    const events = normalizeOpencodeEvent({
      type: "message.part.updated",
      properties: { part: { id: "p3", reasoning_content: "legacy", sessionID: "s" } },
    })
    expect(events).toContainEqual({ kind: "reasoning-delta", partId: "p3", delta: "legacy" })
  })

  it("flags provider auth errors", () => {
    const events = normalizeOpencodeEvent({
      type: "session.error",
      properties: { error: { name: "ProviderAuthError", data: { message: "bad key" } } },
    })
    expect(events[0]).toEqual({ kind: "error", errorText: "bad key", auth: true })
  })

  it("emits idle", () => {
    expect(normalizeOpencodeEvent({ type: "session.idle", properties: {} })).toEqual([
      { kind: "idle" },
    ])
  })

  it("normalizes provider usage for persistence and Track B reconciliation", () => {
    const events = normalizeOpencodeEvent({
      type: "message.updated",
      properties: {
        info: {
          tokens: { input: 12, output: 7, reasoning: 3, total: 19 },
          cost: 0.004,
          id: "gen-1",
        },
      },
    })
    expect(events).toContainEqual({
      kind: "usage",
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        reasoningTokens: 3,
        totalTokens: 19,
        costUsd: 0.004,
        costQuality: "provider-reported",
        generationId: "gen-1",
      },
    })
  })

  it("surfaces permission requests", () => {
    const events = normalizeOpencodeEvent({
      type: "permission.asked",
      properties: { id: "req1", tool: { callID: "call1" }, permission: "edit" },
    })
    expect(events[0]).toEqual({
      kind: "permission-asked",
      requestId: "req1",
      toolCallId: "call1",
      permission: "edit",
    })
  })
})

describe("chunk mapper", () => {
  it("opens a text part once and closes it on finish", () => {
    const mapper = new SidecarChunkMapper()
    const first = mapper.map({ kind: "text-delta", partId: "a", delta: "hi" })
    expect(first[0]).toEqual({ type: "text-start", id: "text-a" })
    expect(first[1]).toEqual({ type: "text-delta", id: "text-a", delta: "hi" })
    const second = mapper.map({ kind: "text-delta", partId: "a", delta: " there" })
    expect(second).toEqual([{ type: "text-delta", id: "text-a", delta: " there" }])
    expect(mapper.finish()).toEqual([{ type: "text-end", id: "text-a" }])
  })

  it("maps reasoning to reasoning-delta", () => {
    const mapper = new SidecarChunkMapper()
    expect(mapper.map({ kind: "reasoning-delta", partId: "r", delta: "why" })).toEqual([
      { type: "reasoning-delta", id: "reasoning-r", delta: "why" },
    ])
  })
})

describe("binary resolution", () => {
  it("reports missing when override path does not exist", () => {
    const prev = process.env.FLAPSTACK_OPENCODE_BIN
    process.env.FLAPSTACK_OPENCODE_BIN = "/definitely/not/here/opencode"
    try {
      expect(resolveOpencodeBinary()).toMatchObject({ kind: "missing" })
    } finally {
      if (prev === undefined) delete process.env.FLAPSTACK_OPENCODE_BIN
      else process.env.FLAPSTACK_OPENCODE_BIN = prev
    }
  })
})

describe("credentials + config", () => {
  let dir: string
  const prevConfigDir = process.env.FLAPSTACK_CONFIG_DIR
  const previousNodeEnv = process.env.NODE_ENV
  const previousOpenRouterKey = process.env.FLAPSTACK_OPENROUTER_API_KEY
  const previousNanoGptKey = process.env.FLAPSTACK_NANOGPT_API_KEY

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "flapstack-cred-test-"))
    process.env.FLAPSTACK_CONFIG_DIR = dir
    process.env.NODE_ENV = "test"
    delete process.env.FLAPSTACK_OPENROUTER_API_KEY
    delete process.env.FLAPSTACK_NANOGPT_API_KEY
  })

  afterAll(() => {
    if (prevConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
    else process.env.FLAPSTACK_CONFIG_DIR = prevConfigDir
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousOpenRouterKey === undefined) delete process.env.FLAPSTACK_OPENROUTER_API_KEY
    else process.env.FLAPSTACK_OPENROUTER_API_KEY = previousOpenRouterKey
    if (previousNanoGptKey === undefined) delete process.env.FLAPSTACK_NANOGPT_API_KEY
    else process.env.FLAPSTACK_NANOGPT_API_KEY = previousNanoGptKey
    rmSync(dir, { recursive: true, force: true })
  })

  it("stores, reads, and clears provider keys", () => {
    expect(hasProviderKey("openrouter")).toBe(false)
    setProviderKey("openrouter", "sk-or-test-123", "https://openrouter.ai/api/v1")
    expect(getProviderKey("openrouter")).toBe("sk-or-test-123")
    expect(getCredentialStatus("openrouter").configured).toBe(true)
    clearProviderKey("openrouter")
    expect(hasProviderKey("openrouter")).toBe(false)
  })

  it("uses ignored local environment keys when no encrypted key is stored", () => {
    const previous = process.env.FLAPSTACK_OPENROUTER_API_KEY
    process.env.FLAPSTACK_OPENROUTER_API_KEY = "local-openrouter-key"
    try {
      expect(getProviderKey("openrouter")).toBe("local-openrouter-key")
      expect(hasProviderKey("openrouter")).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.FLAPSTACK_OPENROUTER_API_KEY
      else process.env.FLAPSTACK_OPENROUTER_API_KEY = previous
    }
  })

  it("generates an isolated config with the key in env, not the file", () => {
    setProviderKey("nanogpt", "nano-secret-key")
    const { config, env } = buildOpencodeConfig("nanogpt")
    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain("nano-secret-key")
    expect(serialized).toContain("{env:FLAPSTACK_NANOGPT_API_KEY}")
    expect(env.FLAPSTACK_NANOGPT_API_KEY).toBe("nano-secret-key")
    clearProviderKey("nanogpt")
  })

  it("declares the selected model for a custom-provider run", () => {
    setProviderKey("nanogpt", "nano-secret-key")
    const { config } = buildOpencodeConfig("nanogpt", "deepseek-chat")
    expect(config.provider).toMatchObject({
      nanogpt: { models: { "deepseek-chat": { name: "deepseek-chat" } } },
    })
    clearProviderKey("nanogpt")
  })

  it("refreshes and serves a locally cached model catalog", async () => {
    setProviderKey("openrouter", "sk-or-test-123")
    const result = await refreshProviderModels(
      "openrouter",
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "beta", name: "Beta", context_length: 200_000, reasoning: true },
              { id: "alpha" },
            ],
          }),
        ),
    )
    expect(result.models).toEqual([
      { id: "alpha", label: "alpha" },
      { id: "beta", label: "Beta", contextWindow: 200_000, supportsReasoning: true },
    ])
    expect(getAvailableProviderModels("openrouter").source).toBe("cache")
    clearProviderKey("openrouter")
  })
})

describe("client prompt attachments", () => {
  it("sends image/file parts before the text prompt", async () => {
    let requestBody: any
    const client = new OpencodeClient({
      baseUrl: "http://127.0.0.1:1234",
      directory: "/repo",
      password: "test",
      fetchImpl: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response("{}", { status: 200 })
      }) as typeof fetch,
    })

    await client.prompt("ses_test", "describe it", { providerId: "openrouter", modelId: "model" }, [
      { mime: "image/png", url: "data:image/png;base64,abc", filename: "shot.png" },
    ])

    expect(requestBody.parts).toEqual([
      {
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,abc",
        filename: "shot.png",
      },
      { type: "text", text: "describe it" },
    ])
  })
})

const liveIt = process.env.FLAPSTACK_OPENCODE_LIVE_TEST === "1" ? it : it.skip
const providerLiveIt = process.env.FLAPSTACK_OPENCODE_PROVIDER_LIVE_TEST === "1" ? it : it.skip

describe("live OpenCode sidecar", () => {
  liveIt(
    "starts the pinned sidecar, reaches health, creates a session, and exits",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "flapstack-opencode-live-"))
      const previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
      const previousNodeEnv = process.env.NODE_ENV
      process.env.FLAPSTACK_CONFIG_DIR = dir
      process.env.NODE_ENV = "test"
      setProviderKey("openrouter", "live-test-key-not-valid-for-provider")

      try {
        const started = await startSidecar({
          provider: "openrouter",
          cwd: process.cwd(),
          startupTimeoutMs: 30_000,
        })
        expect(started.ok).toBe(true)
        if (!started.ok) return

        const client = new OpencodeClient({
          baseUrl: started.handle.baseUrl,
          directory: process.cwd(),
          password: started.handle.password,
        })
        await expect(client.health()).resolves.toMatchObject({ healthy: true })
        await expect(client.createSession()).resolves.toMatch(/^ses_/)

        const exited = new Promise<void>((resolve) =>
          started.handle.process.once("exit", () => resolve()),
        )
        started.handle.stop()
        await Promise.race([
          exited,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Sidecar did not exit")), 5_000),
          ),
        ])
      } finally {
        if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
        else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previousNodeEnv
        rmSync(dir, { recursive: true, force: true })
      }
    },
    45_000,
  )

  providerLiveIt(
    "streams a minimal OpenRouter completion through the sidecar",
    async () => {
      const events = []
      for await (const event of runSidecarSession({
        provider: "openrouter",
        model: "openrouter/tencent/hy3:free",
        prompt: "Reply with exactly: smoke ok",
        cwd: process.cwd(),
        permissionMode: "read-only",
      })) {
        events.push(event)
      }

      const errors = events.filter((event) => event.kind === "error")
      expect(errors).toEqual([])
      expect(events.some((event) => event.kind === "session-start")).toBe(true)
      expect(events.some((event) => event.kind === "text-delta")).toBe(true)
      expect(events.at(-1)).toEqual({ kind: "phase", phase: "done" })
    },
    90_000,
  )

  providerLiveIt(
    "streams a minimal NanoGPT completion through the sidecar",
    async () => {
      const events = []
      for await (const event of runSidecarSession({
        provider: "nanogpt",
        model: "nanogpt/deepseek-chat",
        prompt: "Reply with exactly: smoke ok",
        cwd: process.cwd(),
        permissionMode: "read-only",
      })) {
        events.push(event)
      }

      const errors = events.filter((event) => event.kind === "error")
      expect(errors).toEqual([])
      expect(events.some((event) => event.kind === "session-start")).toBe(true)
      expect(events.some((event) => event.kind === "text-delta")).toBe(true)
      expect(events.at(-1)).toEqual({ kind: "phase", phase: "done" })
    },
    90_000,
  )
})
