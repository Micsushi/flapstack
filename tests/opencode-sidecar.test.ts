import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  buildOpencodePermissionApplication,
  buildOpencodePermissionConfig,
} from "../src/main/lib/harness/opencode-sidecar/permissions"
import { OpencodeRunAuditAccumulator } from "../src/main/lib/harness/opencode-sidecar/persistence"
import { OpencodeClient } from "../src/main/lib/harness/opencode-sidecar/client"
import {
  clearProviderKeyAsync,
  getProviderKeyAsync,
} from "../src/main/lib/harness/opencode-sidecar/credentials"
import { sanitizeSidecarParentEnvironment } from "../src/main/lib/harness/opencode-sidecar/launcher"
import { handlePermissionRequest } from "../src/main/lib/harness/opencode-sidecar/session"

describe("permission mapping", () => {
  it("read-only denies all mutating tools", () => {
    expect(buildOpencodePermissionConfig("read-only")).toEqual({
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
    })
  })
})

describe("approval bridge", () => {
  it("recognizes only launch-owned OpenCode product MCP permission names", async () => {
    const replies: unknown[][] = []
    const client = {
      replyPermission: async (...args: unknown[]) => replies.push(args),
    } as unknown as OpencodeClient
    const onApproval = vi.fn(async () => ({ reply: "reject" as const }))
    const request = {
      kind: "permission-asked" as const,
      requestId: "product-request",
      toolCallId: "product-call",
      permission: "flapstack_create_task",
      patterns: [],
    }

    await expect(
      handlePermissionRequest(
        client,
        {
          provider: "openrouter",
          model: "openrouter/test-model",
          prompt: "test",
          cwd: "/repo",
          permissionMode: "ask-before-edits",
          reasoningEnabled: false,
          reasoningEffort: "medium",
          reasoningSupported: null,
          productMcp: { command: "/product-mcp", args: [], env: {} },
        },
        onApproval,
        request,
      ),
    ).resolves.toMatchObject({ decision: { reply: "once" }, source: "policy" })
    expect(onApproval).not.toHaveBeenCalled()

    await handlePermissionRequest(
      client,
      {
        provider: "openrouter",
        model: "openrouter/test-model",
        prompt: "test",
        cwd: "/repo",
        permissionMode: "ask-before-edits",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        reasoningSupported: null,
      },
      onApproval,
      { ...request, requestId: "third-party-request" },
    )
    expect(onApproval).toHaveBeenCalledOnce()
    expect(replies).toEqual([
      ["product-request", "once"],
      ["third-party-request", "reject", undefined],
    ])
  })
})

describe("sanitized run audit persistence", () => {
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
})
