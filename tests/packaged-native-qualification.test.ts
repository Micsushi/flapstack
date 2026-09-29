import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import {
  assertCancelled,
  assertCompleted,
  assertCredentialFreshness,
  assertRestart,
  childEnvironment,
  cleanupCredentialCopy,
  qualificationCases,
  validateQualification,
} from "../scripts/qualify-packaged-native-windows.mjs"
import { isHiddenPreviewVerification } from "../src/main/lib/mcp-test-control/lifecycle"

const valid = {
  env: { FLAPSTACK_RUN_PACKAGED_NATIVE_QUALIFICATION: "1" },
  platform: "win32",
  nodeVersion: "22.23.1",
  executable: "Flapstack Preview.exe",
  provenance: { build: { channel: "preview" }, package: { productName: "Flapstack Preview" } },
}

test("qualification refuses live calls without explicit Preview Windows Node 22 identity", () => {
  validateQualification(valid)
  for (const change of [
    { env: {} },
    { platform: "darwin" },
    { nodeVersion: "25.0.0" },
    { executable: "Flapstack.exe" },
    {
      provenance: { build: { channel: "release" }, package: { productName: "Flapstack Preview" } },
    },
    { provenance: {} },
  ])
    assert.throws(() => validateQualification({ ...valid, ...change }))
})

test("isolated provider credentials are removed only when they have not drifted", () => {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-credential-reconcile-"))
  const source = join(directory, "source.json")
  const isolated = join(directory, "isolated.json")
  const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
  try {
    writeFileSync(source, "original")
    writeFileSync(isolated, "original")
    const originalSha256 = createHash("sha256").update("original").digest("hex")
    assert.equal(cleanupCredentialCopy({ source, isolated, originalSha256 }, sha256), "removed")
    assert.equal(readFileSync(source, "utf8"), "original")
    assert.equal(existsSync(isolated), false)

    writeFileSync(source, "concurrent-source")
    writeFileSync(isolated, "different-refresh")
    assert.equal(cleanupCredentialCopy({ source, isolated, originalSha256 }, sha256), "drift")
    assert.equal(readFileSync(source, "utf8"), "concurrent-source")
    assert.equal(existsSync(isolated), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("qualification requires provider access tokens with a thirty-minute safety margin", () => {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-credential-expiry-"))
  const codex = join(directory, "auth.json")
  const claude = join(directory, ".credentials.json")
  const now = Date.UTC(2026, 0, 1)
  const jwt = (expirySeconds: number) =>
    `e30.${Buffer.from(JSON.stringify({ exp: expirySeconds })).toString("base64url")}.signature`
  try {
    writeFileSync(
      codex,
      JSON.stringify({ tokens: { access_token: jwt((now + 31 * 60_000) / 1000) } }),
    )
    writeFileSync(claude, JSON.stringify({ claudeAiOauth: { expiresAt: now + 31 * 60_000 } }))
    assertCredentialFreshness(codex, claude, now)
    writeFileSync(claude, JSON.stringify({ claudeAiOauth: { expiresAt: now + 29 * 60_000 } }))
    assert.throws(() => assertCredentialFreshness(codex, claude, now))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("child environment discards inherited test controls and uses unique hidden Preview identity", () => {
  const env = childEnvironment(
    {
      PATH: "tools",
      FLAPSTACK_ENABLE_DEV_TEST_CONTROL: "1",
      FLAPSTACK_STAGE6_HEADLESS: "1",
      FLAPSTACK_PROJECT_RECORDS_TOKEN: "secret",
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_RENDERER_URL: "http://localhost",
    },
    "123-abcd",
    "C:\\owned-codex-home",
    "C:\\owned-claude-config",
  )
  assert.equal(env.PATH, "tools")
  assert.equal(env.FLAPSTACK_PREVIEW_INSTANCE, "preview-bridge-123-abcd")
  assert.match(env.FLAPSTACK_PREVIEW_RUN_TOKEN, /^pb-123-abcd-[a-f0-9]{12}$/)
  assert.equal(env.FLAPSTACK_PREVIEW_HEADLESS, "1")
  assert.equal(env.CODEX_HOME, "C:\\owned-codex-home")
  assert.equal(env.CLAUDE_CONFIG_DIR, "C:\\owned-claude-config")
  assert.equal(isHiddenPreviewVerification(env), true)
  assert.equal(env.FLAPSTACK_ENABLE_DEV_TEST_CONTROL, undefined)
  assert.equal(env.FLAPSTACK_PROJECT_RECORDS_TOKEN, undefined)
  assert.equal(env.FLAPSTACK_STAGE6_HEADLESS, undefined)
  assert.equal(env.FLAPSTACK_ENABLE_UNVERIFIED_NATIVE_RUNTIMES, undefined)
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.ELECTRON_RENDERER_URL, undefined)
})

test("both requested direct providers require exact model, transcript, turn identity and no tools", () => {
  assert.deepEqual(qualificationCases, [
    { harness: "codex", provider: "codex", model: "gpt-5.5", effort: "low" },
    { harness: "claude-code", provider: "claude", model: "claude-opus-5-5", effort: "medium" },
  ])
  for (const spec of qualificationCases) {
    const expected = { ...spec, runId: "run", subChatId: "chat", nonce: "NONCE", prompt: "prompt" }
    const state = {
      runs: [
        {
          id: "run",
          harness: spec.harness,
          status: "success",
          model: spec.model,
          runtime_preference: spec.harness,
          resolved_runtime: spec.harness,
          permission_mode: "read-only",
          runtime_adapter_version: "1",
          runtime_protocol_version: "1",
          runtime_control_snapshot: JSON.stringify({ modelEffort: spec.effort }),
          prompt_message_id: "prompt-id",
        },
      ],
      activity: [
        {
          run_id: "run",
          kind: "lifecycle",
          provider_session_id: "session",
          provider_turn_id: "turn",
          provider_message_id: "result",
          payload_json: JSON.stringify({ state: "result:success" }),
        },
        ...(spec.harness === "claude-code"
          ? [
              {
                run_id: "run",
                kind: "lifecycle",
                provider_session_id: "session",
                provider_turn_id: null,
                provider_message_id: null,
                payload_json: JSON.stringify({
                  state: "session-initialized",
                  detail: JSON.stringify({ model: spec.model, mcpServers: [] }),
                }),
              },
              {
                run_id: "run",
                kind: "agent-text",
                provider_session_id: "session",
                provider_turn_id: null,
                provider_message_id: "assistant-message",
                payload_json: JSON.stringify({ text: "NONCE" }),
              },
            ]
          : []),
      ],
      subChats: [
        {
          id: "chat",
          messages: JSON.stringify([
            { id: "prompt-id", role: "user", parts: [{ type: "text", text: "prompt" }] },
            {
              role: "assistant",
              metadata: { runId: "run" },
              parts: [{ type: "text", text: "NONCE" }],
            },
          ]),
        },
      ],
    }
    assertCompleted(state, expected)
    const continuation = {
      ...expected,
      runId: "continued-run",
      nonce: "CONTINUED",
      prompt: "follow-up",
      messageOffset: 2,
    }
    const continuedState = structuredClone(state)
    continuedState.runs.push({
      ...state.runs[0],
      id: continuation.runId,
      prompt_message_id: "continued-prompt-id",
    })
    continuedState.activity.push(
      ...state.activity.map((event) => ({ ...event, run_id: continuation.runId })),
    )
    continuedState.subChats[0].messages = JSON.stringify([
      ...JSON.parse(state.subChats[0].messages),
      {
        id: "continued-prompt-id",
        role: "user",
        parts: [{ type: "text", text: continuation.prompt }],
      },
      {
        role: "assistant",
        metadata: { runId: continuation.runId },
        parts: [{ type: "text", text: continuation.nonce }],
      },
    ])
    assertCompleted(continuedState, continuation)
    for (const change of [
      { status: "failed" },
      { model: "wrong" },
      { permission_mode: "full-access" },
      { resolved_runtime: "flapstack-native" },
      { prompt_message_id: "other" },
      { runtime_control_snapshot: JSON.stringify({ modelEffort: "wrong" }) },
    ])
      assert.throws(() =>
        assertCompleted({ ...state, runs: [{ ...state.runs[0], ...change }] }, expected),
      )
    assert.throws(() => assertCompleted({ ...state, activity: [] }, expected))
    for (const kind of ["tool", "command", "patch"])
      assert.throws(() =>
        assertCompleted({ ...state, activity: [{ ...state.activity[0], kind }] }, expected),
      )
    assert.throws(() => assertCompleted(state, { ...expected, nonce: "different" }))
    if (spec.harness === "claude-code") {
      const wrongModel = structuredClone(state)
      wrongModel.activity[1].payload_json = JSON.stringify({
        state: "session-initialized",
        detail: JSON.stringify({ model: "wrong", mcpServers: [] }),
      })
      assert.throws(() => assertCompleted(wrongModel, expected))
    }
    assertCancelled({ ...state, runs: [{ ...state.runs[0], status: "cancelled" }] }, expected)
    assertRestart(state, structuredClone(state))
    const replay = structuredClone(state)
    replay.runs.push({ ...state.runs[0], id: "replay" })
    assert.throws(() => assertRestart(state, replay))
    const drift = structuredClone(state)
    drift.activity[0].provider_turn_id = "other-turn"
    assert.throws(() => assertRestart(state, drift))
    const transcript = structuredClone(state)
    transcript.subChats[0].messages = "[]"
    assert.throws(() => assertRestart(state, transcript))
  }
})
