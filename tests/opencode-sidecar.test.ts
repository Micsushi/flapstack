import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { readUIMessageStream } from "ai"

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
import {
  finalizeOpencodeRunPersistence,
  mergeMessagesById,
  OpencodeRunAuditAccumulator,
  sanitizeOpencodeAuditValue,
  sanitizeOpencodeCommand,
} from "../src/main/lib/harness/opencode-sidecar/persistence"
import {
  executableSearchDirs,
  resolveOpencodeBinary,
} from "../src/main/lib/harness/opencode-sidecar/binary"
import { OpencodeClient } from "../src/main/lib/harness/opencode-sidecar/client"
import {
  buildOpencodeConfig,
  writeIsolatedConfig,
} from "../src/main/lib/harness/opencode-sidecar/config"
import {
  clearProviderKey,
  clearProviderKeyAsync,
  getCredentialStatus,
  getCredentialStatusAsync,
  getProviderKey,
  getProviderKeyAsync,
  hasProviderKey,
  setProviderKey,
  setProviderKeyAsync,
} from "../src/main/lib/harness/opencode-sidecar/credentials"
import {
  getAvailableProviderModels,
  refreshProviderModels,
} from "../src/main/lib/harness/opencode-sidecar/models"
import {
  sanitizeSidecarParentEnvironment,
  startSidecar,
} from "../src/main/lib/harness/opencode-sidecar/launcher"
import {
  handlePermissionRequest,
  isAlreadyResolvedPermissionReplyError,
  isStaleSidecarSessionError,
  runSidecarSession,
  streamEvents,
} from "../src/main/lib/harness/opencode-sidecar/session"
import { isOpencodeHarness, OPENCODE_HARNESSES } from "../src/shared/harness-types"
import { estimateCostUsd } from "../src/main/lib/usage/pricing"
import { mergeSidecarUsage } from "../src/main/lib/harness/opencode-sidecar/usage"
import { startOpenRouterGenerationProxy } from "../src/main/lib/harness/opencode-sidecar/generation-proxy"
import { sanitizeProviderErrorText } from "../src/main/lib/harness/provider-error"

describe("provider error boundary", () => {
  it("turns stale-session failures into a safe retry message", () => {
    const message = sanitizeProviderErrorText("OpenCode session.fork failed: HTTP 404")
    expect(message).toBe("The previous provider session expired. Start a fresh response and retry.")
    expect(message).not.toMatch(/opencode|1code|session\.fork/i)
  })

  it("removes inherited engine names from other errors", () => {
    const message = sanitizeProviderErrorText("OpenCode session.prompt_async failed: HTTP 500")
    expect(message).toBe("Provider runtime session request failed: HTTP 500")
    expect(message).not.toMatch(/opencode|1code|prompt_async/i)
  })
})

describe("stale provider session recovery", () => {
  it("recovers only from a missing fork source", () => {
    expect(isStaleSidecarSessionError(new Error("OpenCode session.fork failed: HTTP 404"))).toBe(
      true,
    )
    expect(isStaleSidecarSessionError(new Error("OpenCode session.fork failed: HTTP 401"))).toBe(
      false,
    )
    expect(
      isStaleSidecarSessionError(new Error("OpenCode session permission update failed: HTTP 404")),
    ).toBe(false)
    expect(isStaleSidecarSessionError(new Error("OpenCode request aborted"))).toBe(false)
  })
})

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

describe("OpenRouter generation provenance", () => {
  it("passes through streaming responses and retains the official generation header", async () => {
    let upstreamUrl = ""
    const proxy = await startOpenRouterGenerationProxy("https://openrouter.ai/api/v1", (async (
      url,
    ) => {
      upstreamUrl = String(url)
      return new Response('data: {"choices":[]}\n\n', {
        headers: {
          "content-type": "text/event-stream",
          "x-generation-id": "gen-official-123",
        },
      })
    }) as typeof fetch)
    try {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: "{}",
      })
      expect(await response.text()).toContain("choices")
      expect(upstreamUrl).toBe("https://openrouter.ai/api/v1/chat/completions")
      expect(proxy.takeGenerationId()).toBe("gen-official-123")
      expect(proxy.takeGenerationId()).toBeUndefined()
    } finally {
      proxy.close()
    }
  })
})

describe("sidecar usage aggregation", () => {
  it("preserves provider-reported quality when every observation agrees", () => {
    const merged = mergeSidecarUsage([
      { inputTokens: 10, costUsd: 0.01, costQuality: "provider-reported" },
      { outputTokens: 5, costUsd: 0.02, costQuality: "provider-reported" },
    ])
    expect(merged).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      costQuality: "provider-reported",
    })
    expect(merged.costUsd).toBeCloseTo(0.03)
  })

  it("uses the weakest quality for mixed observations", () => {
    expect(
      mergeSidecarUsage([
        { inputTokens: 2, costUsd: 0.01, costQuality: "estimated" },
        { outputTokens: 3, costUsd: 0.02, costQuality: "estimated" },
      ]).costQuality,
    ).toBe("estimated")
    const mixed = mergeSidecarUsage([
      { costUsd: 0.01, costQuality: "provider-reported" },
      { costUsd: 0.02, costQuality: "estimated" },
    ])
    expect(mixed.costQuality).toBe("estimated")
    expect(mixed.costUsd).toBeCloseTo(0.03)
    expect(
      mergeSidecarUsage([
        { costUsd: 0.01, costQuality: "estimated" },
        { inputTokens: 1, costQuality: "unknown" },
      ]),
    ).toMatchObject({ costUsd: 0.01, costQuality: "unknown" })
    expect(mergeSidecarUsage([])).toEqual({ costQuality: "unknown" })
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
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "glob", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "list", pattern: "*", action: "allow" },
      { permission: "lsp", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "allow" },
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
    expect(classifyPermission("read")).toBe("read")
    expect(classifyPermission("glob")).toBe("read")
    expect(classifyPermission("grep")).toBe("read")
  })

  it("auto-decides unambiguous modes and defers ambiguous ones", () => {
    expect(decideAutoApproval("read-only", "edit")).toEqual({
      reply: "reject",
      message: expect.stringContaining("read-only"),
    })
    expect(decideAutoApproval("full-access", "bash")).toEqual({ reply: "once" })
    expect(decideAutoApproval("read-only", "read")).toEqual({ reply: "once" })
    // ask-before-edits on an editing tool must route to the user (null).
    expect(decideAutoApproval("ask-before-edits", "edit")).toBeNull()
  })

  it("surfaces honest limitations without claiming false enforcement", () => {
    const app = buildOpencodePermissionApplication({ permissionMode: "read-only", cwd: "/repo" })
    expect(app.requested).toBe("read-only")
    expect(app.limitations).toHaveLength(0)
    expect(app.degraded).toBe(false)
    const full = buildOpencodePermissionApplication({ permissionMode: "full-access", cwd: "/repo" })
    expect(full.limitations).toHaveLength(0)
    expect(full.degraded).toBe(false)
  })
})

describe("SSE parsing", () => {
  it("aborts a provider run when the event stream exceeds its idle deadline", async () => {
    const abort = vi.fn().mockResolvedValue(undefined)
    const response = new Response(
      new ReadableStream({
        start() {
          // Intentionally never emits or closes.
        },
      }),
    )
    const events = []
    for await (const event of streamEvents({
      client: { abort } as any,
      handle: {} as any,
      sessionId: "session-1",
      input: {
        provider: "openrouter",
        model: "openrouter/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "read-only",
      },
      eventResponse: response,
      eventIdleTimeoutMs: 5,
    })) {
      events.push(event)
    }
    expect(abort).toHaveBeenCalledWith("session-1")
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "error", errorText: expect.stringContaining("idle") }),
    )
  })

  it("treats unexpected EOF as a failed run", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    )
    const events = []
    for await (const event of streamEvents({
      client: {} as any,
      handle: {} as any,
      sessionId: "session-1",
      input: {
        provider: "openrouter",
        model: "openrouter/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "read-only",
      },
      eventResponse: response,
    })) {
      events.push(event)
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "error",
        errorText: expect.stringContaining("before the run completed"),
      }),
    )
  })

  it("frames complete events and buffers partials", () => {
    const first = parseSseChunk("", 'id: 1\nevent: message\ndata: {"a":1}\n\ndata: {"b"')
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({ id: "1", data: '{"a":1}' })
    const second = parseSseChunk(first.buffer, ":2}\n\n")
    expect(second.events[0].data).toBe('{"b":2}')
  })

  it("attaches proxy generation ids to matching OpenCode usage observations", async () => {
    const response = new Response(
      [
        `data: ${JSON.stringify({
          type: "message.updated",
          properties: {
            info: { sessionID: "session-1", id: "message-1", tokens: { input: 2, output: 3 } },
          },
        })}\n\n`,
        `data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`,
      ].join(""),
    )
    const events = []
    for await (const event of streamEvents({
      client: {} as any,
      handle: { takeGenerationId: () => "gen-official-456" } as any,
      sessionId: "session-1",
      input: {
        provider: "openrouter",
        model: "openrouter/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "read-only",
      },
      eventResponse: response,
    })) {
      events.push(event)
    }
    expect(events).toContainEqual({
      kind: "usage",
      usage: expect.objectContaining({
        observationId: "message-1",
        generationId: "gen-official-456",
      }),
    })
  })

  it("surfaces permissions from a child agent without merging its output", async () => {
    const response = new Response(
      [
        `data: ${JSON.stringify({
          type: "message.part.updated",
          properties: {
            part: {
              id: "child-text",
              sessionID: "child-session",
              type: "text",
              text: "private child output",
            },
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "permission.asked",
          properties: {
            sessionID: "child-session",
            id: "child-permission",
            tool: { callID: "child-read" },
            permission: "external_directory",
            patterns: ["/vault/*"],
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "session.idle",
          properties: { sessionID: "parent-session" },
        })}\n\n`,
      ].join(""),
    )
    const events = []
    for await (const event of streamEvents({
      client: { replyPermission: vi.fn() } as any,
      handle: {} as any,
      sessionId: "parent-session",
      input: {
        provider: "openrouter",
        model: "openrouter/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "full-access",
      },
      eventResponse: response,
    })) {
      events.push(event)
    }
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "permission-asked", requestId: "child-permission" }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({ kind: "text-delta", delta: "private child output" }),
    )
  })

  it("reuses one always decision for duplicate permission scopes", async () => {
    const permissionEvent = (id: string, callID: string) =>
      `data: ${JSON.stringify({
        type: "permission.asked",
        properties: {
          sessionID: "session-1",
          id,
          tool: { callID },
          permission: "external_directory",
          patterns: ["/vault/*"],
        },
      })}\n\n`
    const response = new Response(
      permissionEvent("permission-1", "read-1") +
        permissionEvent("permission-2", "read-2") +
        `data: ${JSON.stringify({
          type: "session.idle",
          properties: { sessionID: "session-1" },
        })}\n\n`,
    )
    const replyPermission = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("OpenCode permission reply failed: HTTP 404"))
    const onApproval = vi.fn().mockResolvedValue({ reply: "always" })
    const events = []
    for await (const event of streamEvents({
      client: { replyPermission } as any,
      handle: {} as any,
      sessionId: "session-1",
      input: {
        provider: "nanogpt",
        model: "nanogpt/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "ask-before-edits",
      },
      onApproval,
      eventResponse: response,
    })) {
      events.push(event)
    }

    expect(onApproval).toHaveBeenCalledTimes(1)
    expect(events.filter((event) => event.kind === "permission-asked")).toHaveLength(1)
    expect(events.filter((event) => event.kind === "permission-decision")).toHaveLength(2)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "permission-decision",
        requestId: "permission-2",
        replyStatus: "no-longer-pending",
      }),
    )
    expect(events.some((event) => event.kind === "error")).toBe(false)
  })

  it("continues after a delayed permission reply expires", async () => {
    const response = new Response(
      `data: ${JSON.stringify({
        type: "permission.asked",
        properties: {
          sessionID: "session-1",
          id: "expired-permission",
          tool: { callID: "bash-1" },
          permission: "bash",
          patterns: ["git status --short"],
        },
      })}\n\n` +
        `data: ${JSON.stringify({
          type: "session.idle",
          properties: { sessionID: "session-1" },
        })}\n\n`,
    )
    const events = []
    for await (const event of streamEvents({
      client: {
        replyPermission: vi
          .fn()
          .mockRejectedValue(new Error("OpenCode permission reply failed: HTTP 404")),
      } as any,
      handle: {} as any,
      sessionId: "session-1",
      input: {
        provider: "openrouter",
        model: "openrouter/test",
        prompt: "test",
        cwd: "/tmp",
        permissionMode: "ask-before-edits",
      },
      onApproval: vi.fn().mockResolvedValue({ reply: "once" }),
      eventResponse: response,
    })) {
      events.push(event)
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "permission-decision",
        requestId: "expired-permission",
        replyStatus: "no-longer-pending",
      }),
    )
    expect(events).toContainEqual({ kind: "idle" })
    expect(events.some((event) => event.kind === "error")).toBe(false)
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
      properties: { part: { id: "p2", reasoning: "reasoning output...", sessionID: "s" } },
    })
    expect(reasoning).toContainEqual({
      kind: "reasoning-delta",
      partId: "p2",
      delta: "reasoning output...",
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

  it("removes echoed Flapstack context envelopes from streamed reasoning", () => {
    const normalizer = new OpencodeEventNormalizer()
    normalizer.normalize({
      type: "message.part.updated",
      properties: { part: { id: "r-context", type: "reasoning", text: "" } },
    })

    expect(
      normalizer.normalize({
        type: "message.part.delta",
        properties: {
          partID: "r-context",
          field: "text",
          delta: "[FLAPSTACK STARTUP CONTEXT]\n[FILE: /repo/AGENTS.md]\nSpoken:\n",
        },
      }),
    ).toEqual([])
    expect(
      normalizer.normalize({
        type: "message.part.delta",
        properties: {
          partID: "r-context",
          field: "text",
          delta: "junk\n[/FILE]\n[/FLAPSTACK STARTUP CONTEXT]\nNow I will inspect the project.",
        },
      }),
    ).toEqual([
      { kind: "reasoning-delta", partId: "r-context", delta: "Now I will inspect the project." },
    ])
  })

  it("removes echoed context envelopes from provider prose without removing the answer", () => {
    const normalizer = new OpencodeEventNormalizer()
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-context",
          type: "text",
          text: `--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---
secret
--- END FLAPSTACK INTERNAL CONTEXT ---
The project is a local-first coding workspace.`,
        },
      },
    })

    expect(events).toEqual([
      {
        kind: "text-delta",
        partId: "text-context",
        delta: "The project is a local-first coding workspace.",
      },
    ])
  })

  it("removes resumed compact context from streamed reasoning without hiding adjacent output", () => {
    const normalizer = new OpencodeEventNormalizer()
    normalizer.normalize({
      type: "message.part.updated",
      properties: { part: { id: "compact-context", type: "reasoning", text: "" } },
    })

    expect(
      normalizer.normalize({
        type: "message.part.delta",
        properties: {
          partID: "compact-context",
          field: "text",
          delta: "I will continue safely.\n--- FLAPSTACK COM",
        },
      }),
    ).toEqual([
      {
        kind: "reasoning-delta",
        partId: "compact-context",
        delta: "I will continue safely.",
      },
    ])

    expect(
      normalizer.normalize({
        type: "message.part.delta",
        properties: {
          partID: "compact-context",
          field: "text",
          delta: `PACT CONTEXT (DO NOT QUOTE) ---
private resumed context
--- END FLAPSTACK COMPACT CONTEXT ---
The operation was aborted.`,
        },
      }),
    ).toEqual([
      {
        kind: "reasoning-delta",
        partId: "compact-context",
        delta: "\nThe operation was aborted.",
      },
    ])
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
        costQuality: "estimated",
        observationId: "gen-1",
      },
    })
  })

  it("keeps text and reasoning baselines separate and preserves opaque metadata", () => {
    const normalizer = new OpencodeEventNormalizer()
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "combined",
          type: "reasoning",
          text: "Visible",
          reasoning: "Private",
          metadata: { encrypted: "opaque" },
        },
      },
    })
    expect(events).toContainEqual({
      kind: "reasoning-delta",
      partId: "combined",
      delta: "Visible",
    })
    expect(events).toContainEqual({
      kind: "reasoning-delta",
      partId: "combined",
      delta: "Private",
    })
    expect(events).toContainEqual({
      kind: "reasoning-metadata",
      partId: "combined",
      metadata: { encrypted: "opaque" },
    })
  })

  it("emits one tool start across pending and running updates", () => {
    const normalizer = new OpencodeEventNormalizer()
    const update = (status: string) =>
      normalizer.normalize({
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool",
            type: "tool",
            callID: "call",
            tool: "bash",
            state: { status, input: {} },
          },
        },
      })
    expect([...update("pending"), ...update("running")]).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "tool-input-start" })]),
    )
    expect(
      [...update("running")].filter((event) => event.kind === "tool-input-start"),
    ).toHaveLength(0)
  })

  it("surfaces permission requests", () => {
    const events = normalizeOpencodeEvent({
      type: "permission.asked",
      properties: {
        id: "req1",
        tool: { callID: "call1" },
        permission: "bash",
        patterns: ["git status", "git diff *"],
        metadata: { command: "git status && git diff --stat" },
      },
    })
    expect(events[0]).toEqual({
      kind: "permission-asked",
      requestId: "req1",
      toolCallId: "call1",
      permission: "bash",
      patterns: ["git status", "git diff *"],
      command: "git status && git diff --stat",
    })
  })
})

describe("OpenCode request deadlines", () => {
  const makeClient = (fetchImpl: typeof fetch) =>
    new OpencodeClient({
      baseUrl: "http://127.0.0.1:1",
      directory: "/tmp",
      password: "test",
      fetchImpl,
      requestTimeoutMs: 5,
    })

  it("times out a response body that never resolves", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    }) as unknown as typeof fetch
    await expect(makeClient(fetchImpl).health()).rejects.toThrow("timed out")
  })

  it("times out a prompt fetch that ignores AbortSignal", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    await expect(makeClient(fetchImpl).promptAsync("session", "hello")).rejects.toThrow("timed out")
  })
})

describe("OpenCode message persistence", () => {
  it("merges by id without erasing a mid-run metadata mutation", () => {
    const current = [
      { id: "user", role: "user", parts: [{ type: "text", text: "new prompt" }] },
      { id: "older", role: "assistant", metadata: { spokenText: "kept" } },
    ]
    expect(
      mergeMessagesById(current, [
        { id: "assistant", role: "assistant", parts: [{ type: "text", text: "done" }] },
      ]),
    ).toEqual([...current, expect.objectContaining({ id: "assistant" })])
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

  it("wraps reasoning deltas in a valid start/end lifecycle", async () => {
    const mapper = new SidecarChunkMapper()
    const chunks = mapper.map({ kind: "reasoning-delta", partId: "r", delta: "why" })
    expect(chunks).toEqual([
      { type: "reasoning-start", id: "reasoning-r" },
      { type: "reasoning-delta", id: "reasoning-r", delta: "why" },
    ])
    const finish = mapper.finish()
    expect(finish).toEqual([{ type: "reasoning-end", id: "reasoning-r" }])

    const messages = []
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of [...chunks, ...finish]) controller.enqueue(chunk)
        controller.close()
      },
    })
    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
      messages.push(message)
    }
    expect(messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ type: "reasoning", text: "why", state: "done" }),
    )
  })

  it("maps a completed reasoning summary through the same valid lifecycle", () => {
    const mapper = new SidecarChunkMapper()
    expect(
      mapper.map({ kind: "reasoning-summary", partId: "summary", text: "Safe summary" }),
    ).toEqual([
      { type: "reasoning-start", id: "reasoning-summary" },
      { type: "reasoning-delta", id: "reasoning-summary", delta: "Safe summary" },
      { type: "reasoning-end", id: "reasoning-summary" },
    ])
    expect(mapper.finish()).toEqual([])
  })
})

describe("approval bridge", () => {
  it("passes exact command and patterns to the approver before replying", async () => {
    const replies: unknown[][] = []
    const client = {
      replyPermission: async (...args: unknown[]) => {
        replies.push(args)
      },
    } as unknown as OpencodeClient
    let approvalRequest: unknown

    const resolution = await handlePermissionRequest(
      client,
      {
        provider: "openrouter",
        model: "openrouter/test-model",
        prompt: "test",
        cwd: "/repo",
        permissionMode: "ask-before-edits",
      },
      async (request) => {
        approvalRequest = request
        return { reply: "once" }
      },
      {
        kind: "permission-asked",
        requestId: "req-1",
        toolCallId: "call-1",
        permission: "bash",
        patterns: ["rm *"],
        command: "rm ./generated.txt",
      },
    )

    expect(approvalRequest).toEqual({
      requestId: "req-1",
      toolCallId: "call-1",
      permission: "bash",
      patterns: ["rm *"],
      command: "rm ./generated.txt",
    })
    expect(replies).toEqual([["req-1", "once"]])
    expect(resolution).toEqual({
      decision: { reply: "once" },
      source: "user",
      replyStatus: "applied",
    })
  })

  it("treats a late permission 404 as no longer pending", async () => {
    const client = {
      replyPermission: async () => {
        throw new Error("OpenCode permission reply failed: HTTP 404")
      },
    } as unknown as OpencodeClient

    await expect(
      handlePermissionRequest(
        client,
        {
          provider: "nanogpt",
          model: "nanogpt/test-model",
          prompt: "test",
          cwd: "/repo",
          permissionMode: "ask-before-edits",
        },
        async () => ({ reply: "always" }),
        {
          kind: "permission-asked",
          requestId: "stale-request",
          toolCallId: "read-2",
          permission: "external_directory",
          patterns: ["/vault/*"],
        },
      ),
    ).resolves.toEqual({
      decision: { reply: "always" },
      source: "user",
      replyStatus: "no-longer-pending",
    })
    expect(
      isAlreadyResolvedPermissionReplyError(
        new Error("OpenCode permission reply failed: HTTP 404"),
      ),
    ).toBe(true)
  })

  it("treats a remembered always reply 404 as already resolved", async () => {
    const client = {
      replyPermission: async () => {
        throw new Error("OpenCode permission reply failed: HTTP 404")
      },
    } as unknown as OpencodeClient
    const remembered = {
      decision: { reply: "always" as const },
      source: "user" as const,
      replyStatus: "applied" as const,
    }

    await expect(
      handlePermissionRequest(
        client,
        {
          provider: "nanogpt",
          model: "nanogpt/test-model",
          prompt: "test",
          cwd: "/repo",
          permissionMode: "ask-before-edits",
        },
        undefined,
        {
          kind: "permission-asked",
          requestId: "stale-request",
          toolCallId: "read-2",
          permission: "external_directory",
          patterns: ["/vault/*"],
        },
        remembered,
      ),
    ).resolves.toEqual({ ...remembered, replyStatus: "no-longer-pending" })
  })
})

describe("sanitized run audit persistence", () => {
  it("records a stale permission reply without claiming it was applied", () => {
    const audit = new OpencodeRunAuditAccumulator()
    audit.apply({
      kind: "permission-asked",
      requestId: "expired-request",
      toolCallId: "bash-1",
      permission: "bash",
      patterns: ["git status --short"],
    })
    audit.apply({
      kind: "permission-decision",
      requestId: "expired-request",
      toolCallId: "bash-1",
      permission: "bash",
      patterns: ["git status --short"],
      reply: "once",
      source: "user",
      replyStatus: "no-longer-pending",
    })

    expect(audit.snapshot().approvalActivity).toContainEqual(
      expect.objectContaining({
        requestId: "expired-request",
        state: "no-longer-pending",
        decision: "once",
      }),
    )
  })

  it("records tool and approval detail while redacting durable secrets", () => {
    const audit = new OpencodeRunAuditAccumulator()
    const permissionApplication = buildOpencodePermissionApplication({
      permissionMode: "ask-before-edits",
      cwd: "/repo",
    })
    audit.apply({ kind: "permission-application", application: permissionApplication })
    audit.apply({ kind: "tool-input-start", toolCallId: "call-1", toolName: "bash" })
    audit.apply({
      kind: "tool-input-available",
      toolCallId: "call-1",
      toolName: "bash",
      input: {
        command: "curl https://example.test",
        apiKey: "must-not-persist",
        accessToken: "must-not-persist",
        headers: { Authorization: "Bearer must-not-persist" },
      },
    })
    audit.apply({ kind: "tool-output", toolCallId: "call-1", output: { stdout: "ok" } })
    audit.apply({
      kind: "permission-asked",
      requestId: "req-1",
      toolCallId: "call-1",
      permission: "bash",
      patterns: ["curl *"],
      command: "OPENROUTER_API_KEY=must-not-persist curl https://example.test",
    })
    audit.apply({
      kind: "permission-decision",
      requestId: "req-1",
      toolCallId: "call-1",
      permission: "bash",
      patterns: ["curl *"],
      reply: "once",
      source: "user",
      replyStatus: "applied",
    })

    const snapshot = audit.snapshot()
    expect(snapshot.permissionApplication).toEqual(permissionApplication)
    expect(snapshot.limitations).toEqual(permissionApplication.limitations)
    expect(snapshot.toolActivity).toEqual([
      expect.objectContaining({
        id: "call-1",
        name: "bash",
        state: "output-available",
        input: {
          command: "curl https://example.test",
          apiKey: "[redacted]",
          accessToken: "[redacted]",
          headers: { Authorization: "[redacted]" },
        },
        output: { stdout: "ok" },
      }),
    ])
    expect(snapshot.approvalActivity).toEqual([
      expect.objectContaining({
        requestId: "req-1",
        patterns: ["curl *"],
        command: "OPENROUTER_API_KEY=[redacted] curl https://example.test",
        state: "resolved",
        decision: "once",
        decisionSource: "user",
      }),
    ])
    expect(audit.toMessageParts()).toEqual([
      expect.objectContaining({
        type: "tool-bash",
        toolCallId: "call-1",
        state: "output-available",
      }),
    ])
  })

  it("bounds cycles, oversized values, and secret-shaped command arguments", () => {
    const cyclic: Record<string, unknown> = { token: "secret" }
    cyclic.self = cyclic
    expect(sanitizeOpencodeAuditValue(cyclic)).toEqual({
      token: "[redacted]",
      self: "[circular]",
    })
    expect(sanitizeOpencodeCommand("tool --password secret Authorization: Bearer abc")).toBe(
      "tool --password [redacted] Authorization: Bearer [redacted]",
    )
    expect(sanitizeOpencodeAuditValue("raw-provider-secret", ["raw-provider-secret"])).toBe(
      "[redacted]",
    )
  })
})

describe("sidecar secret isolation", () => {
  it("removes unrelated parent credentials while preserving SSH agent access", () => {
    expect(
      sanitizeSidecarParentEnvironment({
        PATH: "/bin",
        GITHUB_TOKEN: "secret",
        ANTHROPIC_API_KEY: "secret",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
      }),
    ).toEqual({ PATH: "/bin", SSH_AUTH_SOCK: "/tmp/agent.sock" })
  })

  it("isolates global config/plugins and installs a tool environment guard", () => {
    const previousConfigDir = process.env.FLAPSTACK_CONFIG_DIR
    const credentialDir = mkdtempSync(join(tmpdir(), "flapstack-sidecar-secret-"))
    process.env.FLAPSTACK_CONFIG_DIR = credentialDir
    setProviderKey("nanogpt", "nano-secret-key")
    const generated = writeIsolatedConfig("nanogpt", "deepseek-chat")
    try {
      const config = JSON.parse(readFileSync(join(generated.configDir, "opencode.json"), "utf8"))
      const pluginUrl = config.plugin?.[0] as string
      const guard = readFileSync(new URL(pluginUrl), "utf8")
      expect(generated.env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1")
      expect(generated.env.XDG_CONFIG_HOME).toContain(generated.configDir)
      expect(guard).toContain("FLAPSTACK_NANOGPT_API_KEY")
      expect(guard).toContain("OPENCODE_SERVER_PASSWORD")
      expect(guard).toContain("delete process.env[name]")
    } finally {
      rmSync(generated.configDir, { recursive: true, force: true })
      clearProviderKey("nanogpt")
      if (previousConfigDir === undefined) delete process.env.FLAPSTACK_CONFIG_DIR
      else process.env.FLAPSTACK_CONFIG_DIR = previousConfigDir
      rmSync(credentialDir, { recursive: true, force: true })
    }
  })
})

describe("run finalization isolation", () => {
  it("finalizes run and sub-chat status before a failing usage capture", async () => {
    const order: string[] = []
    const errors: string[] = []
    const updateRunStatus = vi.fn((checkpointId?: string) => {
      order.push(`run:${checkpointId}`)
    })
    const updateSubChatStatus = vi.fn(() => order.push("subchat"))

    await finalizeOpencodeRunPersistence({
      captureAfter: async () => {
        order.push("checkpoint")
        return "checkpoint-after"
      },
      updateRunStatus,
      updateSubChatStatus,
      captureManifest: () => order.push("manifest"),
      captureUsage: async () => {
        order.push("usage")
        throw new Error("usage unavailable")
      },
      onError: (stage) => errors.push(stage),
    })

    expect(updateRunStatus).toHaveBeenCalledWith("checkpoint-after")
    expect(updateSubChatStatus).toHaveBeenCalledOnce()
    expect(order).toEqual(["checkpoint", "run:checkpoint-after", "subchat", "manifest", "usage"])
    expect(errors).toEqual(["usage"])
  })
})

describe("session preflight audit", () => {
  it("emits permission application and limitations before a model preflight failure", async () => {
    const events = []
    for await (const event of runSidecarSession({
      provider: "openrouter",
      model: "nanogpt/wrong-provider",
      prompt: "test",
      cwd: "/repo",
      permissionMode: "ask-before-edits",
    })) {
      events.push(event)
    }

    expect(events[0]).toMatchObject({
      kind: "permission-application",
      application: { requested: "ask-before-edits" },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "error",
        errorText: expect.stringContaining("does not belong"),
      }),
    )
  })
})

describe("binary resolution", () => {
  it("adds packaged macOS fallback locations", () => {
    if (process.platform !== "darwin") return
    expect(executableSearchDirs()).toEqual(
      expect.arrayContaining(["/opt/homebrew/bin", "/usr/local/bin"]),
    )
  })

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

  it("reports a legacy-file credential passively before first use", () => {
    const legacyPath = join(dir, "opencode-provider-credentials.json")
    writeFileSync(
      legacyPath,
      JSON.stringify({ nanogpt: { value: "legacy-status-secret", encrypted: false } }),
      { mode: 0o600 },
    )

    expect(getCredentialStatus("nanogpt")).toMatchObject({
      configured: true,
      source: "legacy-file",
      warning: expect.stringMatching(/will migrate securely/i),
    })
    expect(JSON.parse(readFileSync(legacyPath, "utf8"))).toHaveProperty("nanogpt")

    clearProviderKey("nanogpt")
  })

  it("removes an unacknowledged legacy-file key before it can migrate later", () => {
    const legacyPath = join(dir, "opencode-provider-credentials.json")
    writeFileSync(
      legacyPath,
      JSON.stringify({
        openrouter: { value: "legacy-openrouter-secret", encrypted: false },
        nanogpt: { value: "legacy-nanogpt-secret", encrypted: false },
      }),
      { mode: 0o600 },
    )

    clearProviderKey("openrouter")

    expect(getProviderKey("openrouter")).toBeNull()
    expect(JSON.parse(readFileSync(legacyPath, "utf8"))).toEqual({
      nanogpt: { value: "legacy-nanogpt-secret", encrypted: false },
    })
    clearProviderKey("nanogpt")
  })

  it("keeps async removal from resurrecting a legacy-file key", async () => {
    const legacyPath = join(dir, "opencode-provider-credentials.json")
    writeFileSync(
      legacyPath,
      JSON.stringify({ openrouter: { value: "legacy-async-secret", encrypted: false } }),
      { mode: 0o600 },
    )

    await clearProviderKeyAsync("openrouter")

    expect(await getProviderKeyAsync("openrouter")).toBeNull()
    expect(JSON.parse(readFileSync(legacyPath, "utf8"))).toEqual({})
  })

  it("fails closed without clearing the current store when the legacy file is unreadable", () => {
    const legacyPath = join(dir, "opencode-provider-credentials.json")
    setProviderKey("openrouter", "current-store-secret")
    writeFileSync(legacyPath, "{broken-json", { mode: 0o600 })

    expect(() => clearProviderKey("openrouter")).toThrow(/Could not clear the legacy openrouter/)
    expect(getProviderKey("openrouter")).toBe("current-store-secret")

    rmSync(legacyPath, { force: true })
    clearProviderKey("openrouter")
  })

  it("adds, reads, and clears multiple provider keys concurrently", async () => {
    await Promise.all([
      setProviderKeyAsync("openrouter", "openrouter-concurrent-key"),
      setProviderKeyAsync("nanogpt", "nanogpt-concurrent-key"),
    ])

    const [openrouterKey, nanogptKey, openrouterStatus, nanogptStatus] = await Promise.all([
      getProviderKeyAsync("openrouter"),
      getProviderKeyAsync("nanogpt"),
      getCredentialStatusAsync("openrouter"),
      getCredentialStatusAsync("nanogpt"),
    ])
    expect(openrouterKey).toBe("openrouter-concurrent-key")
    expect(nanogptKey).toBe("nanogpt-concurrent-key")
    expect(openrouterStatus.configured).toBe(true)
    expect(nanogptStatus.configured).toBe(true)

    await Promise.all([clearProviderKeyAsync("openrouter"), clearProviderKeyAsync("nanogpt")])
    expect(await getProviderKeyAsync("openrouter")).toBeNull()
    expect(await getProviderKeyAsync("nanogpt")).toBeNull()
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

  it("injects the run-scoped product MCP into isolated OpenCode config", () => {
    setProviderKey("nanogpt", "nano-secret-key")
    const { config } = buildOpencodeConfig(
      "nanogpt",
      "deepseek-chat",
      undefined,
      true,
      "high",
      true,
      {
        command: "/Flapstack",
        args: ["/app/out/main/mcp-control-stdio.js"],
        env: { FLAPSTACK_MCP_CHAT_ID: "chat-1", FLAPSTACK_MCP_RUN_ID: "run-1" },
      },
    )
    expect(config.mcp).toEqual({
      flapstack: {
        type: "local",
        command: ["/Flapstack", "/app/out/main/mcp-control-stdio.js"],
        environment: { FLAPSTACK_MCP_CHAT_ID: "chat-1", FLAPSTACK_MCP_RUN_ID: "run-1" },
        enabled: true,
      },
    })
    clearProviderKey("nanogpt")
  })

  it("maps the per-chat reasoning toggle and depth into provider options", () => {
    setProviderKey("openrouter", "openrouter-secret-key")
    const enabled = buildOpencodeConfig(
      "openrouter",
      "anthropic/claude-opus-4-8",
      undefined,
      true,
      "xhigh",
    ).config
    expect(enabled.provider).toMatchObject({
      openrouter: {
        models: {
          "anthropic/claude-opus-4-8": {
            options: {
              reasoning: { enabled: true, effort: "xhigh", exclude: false },
              includeReasoning: true,
            },
          },
        },
      },
    })

    const disabled = buildOpencodeConfig(
      "openrouter",
      "anthropic/claude-opus-4-8",
      undefined,
      false,
      "high",
    ).config
    expect(disabled.provider).toMatchObject({
      openrouter: {
        models: {
          "anthropic/claude-opus-4-8": {
            options: {
              reasoning: { enabled: false, exclude: true },
              includeReasoning: false,
            },
          },
        },
      },
    })
    expect(JSON.stringify(enabled)).not.toContain("reasoningEffort")
    expect(JSON.stringify(disabled)).not.toContain("reasoningEffort")
    clearProviderKey("openrouter")
  })

  it("omits reasoning fields for a model without declared support", () => {
    setProviderKey("openrouter", "openrouter-secret-key")
    const generated = buildOpencodeConfig(
      "openrouter",
      "plain-model",
      undefined,
      true,
      "xhigh",
      null,
    )
    expect(generated.config.provider).toMatchObject({
      openrouter: { models: { "plain-model": { name: "plain-model" } } },
    })
    expect(
      (generated.config.provider as any).openrouter.models["plain-model"].options,
    ).toBeUndefined()
    expect(generated.reasoningResolution).toMatchObject({ exact: false, sent: {} })
    expect(generated.reasoningResolution.limitations).toHaveLength(2)
    clearProviderKey("openrouter")
  })

  it("refreshes and serves a locally cached model catalog", async () => {
    setProviderKey("openrouter", "sk-or-test-123")
    let requestUrl = ""
    const result = await refreshProviderModels("openrouter", async (url) => {
      requestUrl = String(url)
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "beta",
              name: "Beta",
              context_length: 200_000,
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
              supported_parameters: ["tools", "tool_choice", "reasoning"],
              pricing: { prompt: "0.000001", completion: "0.000002" },
            },
            { id: "alpha" },
          ],
        }),
      )
    })
    expect(requestUrl).toBe("https://openrouter.ai/api/v1/models")
    expect(result.models).toEqual([
      { id: "alpha", label: "alpha" },
      {
        id: "beta",
        label: "Beta",
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsTools: true,
        supportedParameters: ["tools", "tool_choice", "reasoning"],
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        pricing: { inputPerMTok: 1, outputPerMTok: 2 },
      },
    ])
    expect(getAvailableProviderModels("openrouter").source).toBe("cache")
    expect(
      estimateCostUsd("openrouter", "openrouter/beta", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(3)
    clearProviderKey("openrouter")
  })

  it("requests detailed NanoGPT pricing and rejects ambiguous units", async () => {
    setProviderKey("nanogpt", "nano-test-123")
    let requestUrl = ""
    const result = await refreshProviderModels("nanogpt", async (url) => {
      requestUrl = String(url)
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "nano-priced",
              pricing: { prompt: 1, completion: 2, unit: "per_million_tokens" },
            },
            {
              id: "nano-ambiguous",
              pricing: { prompt: 0.000001, completion: 0.000002 },
            },
          ],
        }),
      )
    })
    expect(requestUrl).toBe("https://nano-gpt.com/api/v1/models?detailed=true")
    expect(result.models.find((model) => model.id === "nano-priced")?.pricing).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 2,
    })
    expect(result.models.find((model) => model.id === "nano-ambiguous")?.pricing).toBeUndefined()
    clearProviderKey("nanogpt")
  })
})

describe("client prompt attachments", () => {
  it("queues an async prompt with image/file parts before text", async () => {
    let requestBody: any
    let requestUrl = ""
    let requestMethod = ""
    const client = new OpencodeClient({
      baseUrl: "http://127.0.0.1:1234",
      directory: "/repo",
      password: "test",
      fetchImpl: (async (url, init) => {
        requestUrl = String(url)
        requestMethod = String(init?.method)
        requestBody = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })

    await client.promptAsync(
      "ses_test",
      "describe it",
      { providerId: "openrouter", modelId: "model" },
      [{ mime: "image/png", url: "data:image/png;base64,abc", filename: "shot.png" }],
    )

    expect(requestMethod).toBe("POST")
    expect(requestUrl).toContain("/session/ses_test/prompt_async")
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
