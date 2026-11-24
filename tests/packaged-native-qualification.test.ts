import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vitest"
import {
  assertQualificationApprovals,
  childEnvironment,
  cleanupCredentialCopy,
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

test("qualification approves only the exact proof edit and diff command", () => {
  const expected = {
    filePath: "C:\\repo\\approval-proof.txt",
    command: "git diff --check -- approval-proof.txt",
    kinds: ["edit", "command"],
  }
  const request = (toolName: string, detail: string) => ({
    origin: { toolName },
    questions: [
      {
        id: "permission",
        question: `Allow ${toolName} for this run?\n\n${detail}`,
      },
    ],
  })
  const edit = request("Write", `Path: ${expected.filePath}`)
  const command = request("Bash", `Command: ${expected.command}`)
  assertQualificationApprovals([edit, command], expected)
  assert.throws(() =>
    assertQualificationApprovals(
      [request("Write", "Path: C:\\repo\\other.txt"), command],
      expected,
    ),
  )
  assert.throws(() =>
    assertQualificationApprovals([edit, command, request("Bash", "Command: git status")], expected),
  )
  assert.throws(() => assertQualificationApprovals([edit], expected))
  assert.throws(() => assertQualificationApprovals([edit, edit], expected))
})
