import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const qualificationCases = [
  { harness: "codex", provider: "codex", model: "gpt-5.6-sol", effort: "high" },
  { harness: "claude-code", provider: "claude", model: "claude-opus-5-5", effort: "high" },
]

export function validateQualification({ env, platform, nodeVersion, executable, provenance }) {
  assert.equal(
    env.FLAPSTACK_RUN_PACKAGED_NATIVE_QUALIFICATION,
    "1",
    "Explicit live-provider opt-in required",
  )
  assert.equal(platform, "win32", "Windows Preview qualification only")
  assert.equal(nodeVersion.split(".")[0], "22", "Node 22 required")
  assert.equal(basename(executable), "Flapstack Preview.exe", "Preview executable required")
  assert.equal(provenance?.build?.channel, "preview", "Preview provenance required")
  assert.equal(
    provenance?.package?.productName,
    "Flapstack Preview",
    "Preview product identity required",
  )
}

export function childEnvironment(env, identity, codexHome, claudeConfigDir) {
  const child = { ...env }
  for (const key of Object.keys(child)) {
    if (
      key.startsWith("FLAPSTACK_") ||
      key === "ELECTRON_RUN_AS_NODE" ||
      key === "ELECTRON_RENDERER_URL"
    )
      delete child[key]
  }
  return {
    ...child,
    FLAPSTACK_PREVIEW_INSTANCE: `preview-bridge-${identity}`,
    FLAPSTACK_PREVIEW_HEADLESS: "1",
    FLAPSTACK_PREVIEW_RUN_TOKEN: `pb-${identity}-${randomBytes(6).toString("hex")}`,
    FLAPSTACK_NO_FOCUS: "1",
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  }
}

export function samePath(left, right, platform = process.platform) {
  const canonical = (value) => {
    const absolute = resolve(value)
    try {
      return realpathSync.native(absolute)
    } catch {
      return absolute
    }
  }
  const [canonicalLeft, canonicalRight] = [canonical(left), canonical(right)]
  return platform === "win32"
    ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
    : canonicalLeft === canonicalRight
}

export function initializeQualificationRepository(projectPath) {
  const configuredIdentity = Object.fromEntries(
    ["user.name", "user.email"].map((key) => [
      key,
      execFileSync("git", ["config", "--get", key], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
    ]),
  )
  assert(
    configuredIdentity["user.name"] && configuredIdentity["user.email"],
    "Git identity required",
  )
  execFileSync("git", ["init", "--quiet", projectPath], { windowsHide: true })
  for (const [key, value] of [
    ["user.name", configuredIdentity["user.name"]],
    ["user.email", configuredIdentity["user.email"]],
    ["commit.gpgSign", "false"],
  ])
    execFileSync("git", ["-C", projectPath, "config", "--local", key, value], {
      windowsHide: true,
    })
  writeFileSync(join(projectPath, "README.md"), "# Packaged native qualification\n")
  for (const spec of qualificationCases)
    writeFileSync(join(projectPath, `${spec.harness}-proof.txt`), "BASELINE\n")
  writeFileSync(join(projectPath, "approval-proof.txt"), "BASELINE\n")
  execFileSync("git", ["-C", projectPath, "add", "."], { windowsHide: true })
  execFileSync("git", ["-C", projectPath, "commit", "--quiet", "-m", "Seed qualification repo"], {
    windowsHide: true,
  })
}

export function qualificationApprovalKind(request, expected) {
  if (request.questions?.length !== 1 || request.questions[0]?.id !== "permission") return null
  const question = request.questions[0].question
  if (
    request.origin?.toolName === "Write" &&
    question === `Allow Write for this run?\n\nPath: ${expected.filePath}`
  )
    return "edit"
  if (
    request.origin?.toolName === "Bash" &&
    question === `Allow Bash for this run?\n\nCommand: ${expected.command}`
  )
    return "command"
  return null
}

export function assertQualificationApprovals(requests, expected) {
  const actual = requests.map((request) => qualificationApprovalKind(request, expected))
  assert(!actual.includes(null), "Unexpected provider approval request")
  assert.deepEqual(actual.sort(), [...expected.kinds].sort(), "Exact provider approvals required")
}

export function assertVisualEvidence(evidence) {
  assert.equal(evidence.activeChatId, evidence.expectedChatId, "Target chat must be active")
  assert(evidence.visibleText.includes(evidence.expectedText), "Target chat proof must be visible")
  assert(
    evidence.bounds?.width >= 300 && evidence.bounds?.height >= 300,
    "Chat pane must be visible",
  )
  assert(evidence.screenshot.length >= 5_000, "Screenshot must contain a rendered application")
}

export function assertCompleted(state, expected) {
  const { run, events, payloads } = assertRun(state, expected, "read-only")
  assert(
    !events.some((event) => ["tool", "command", "patch"].includes(event.kind)),
    "Tool activity prohibited",
  )
  assertProviderIdentity(expected, payloads)
  assertTranscript(state, expected, run)
}

export function assertCodingCompleted(state, expected) {
  const { run, events, payloads } = assertRun(
    state,
    expected,
    expected.permissionMode ?? "full-access",
  )
  const toolEvents = events.filter((event) => ["tool", "command", "patch"].includes(event.kind))
  assert(toolEvents.length > 0, "Coding run tool activity required")
  if (expected.harness === "codex") {
    const completedPatch = toolEvents.find((event) => {
      if (event.kind !== "patch" || !successfulActivity(event)) return false
      const payload = JSON.parse(event.payload_json)
      const paths = [payload.path, ...(payload.changes ?? []).map((change) => change.path)]
      return paths.some((path) => matchingPath(path, expected.filePath))
    })
    assert(completedPatch, "Codex completed file-edit activity for the proof file required")
    const completedCommand = toolEvents.find((event) => {
      if (event.kind !== "command" || !successfulActivity(event)) return false
      const payload = JSON.parse(event.payload_json)
      return (
        typeof payload.command === "string" &&
        payload.command.includes("git diff --check") &&
        payload.command.includes(expected.filePath) &&
        (payload.exitCode == null || payload.exitCode === 0)
      )
    })
    assert(completedCommand, "Codex successful git diff command activity required")
  } else {
    const completedToolIds = new Set(
      toolEvents
        .filter(
          (event) => event.kind === "tool" && event.provider_tool_id && successfulActivity(event),
        )
        .map((event) => event.provider_tool_id),
    )
    const edit = toolEvents.find((event) => {
      if (event.kind !== "tool" || !event.provider_tool_id) return false
      const payload = JSON.parse(event.payload_json)
      return (
        /^(edit|write)$/i.test(String(payload.name ?? "")) &&
        completedToolIds.has(event.provider_tool_id) &&
        matchingPath(payload.input?.file_path, expected.filePath)
      )
    })
    assert(edit, "Claude completed file-edit activity for the proof file required")
    const shell = toolEvents.find((event) => {
      if (event.kind !== "tool" || !event.provider_tool_id) return false
      const payload = JSON.parse(event.payload_json)
      const command = payload.input?.command
      return (
        /^(bash|powershell)$/i.test(String(payload.name ?? "")) &&
        completedToolIds.has(event.provider_tool_id) &&
        typeof command === "string" &&
        command.includes("git diff --check") &&
        command.includes(expected.filePath)
      )
    })
    assert(shell, "Claude successful git diff shell activity required")
  }
  assert(
    expected.approvalMode === "interactive" || !events.some((event) => event.kind === "permission"),
    "Full-access coding run must not request interactive approval",
  )
  assertProviderIdentity(expected, payloads, expected.providerPermissionMode ?? "bypassPermissions")
  assertTranscript(state, expected, run)

  assert(run.before_checkpoint_id, "Before checkpoint required")
  assert(run.after_checkpoint_id, "After checkpoint required")
  assert.notEqual(run.before_checkpoint_id, run.after_checkpoint_id)
  const checkpoints = state.checkpoints.filter((checkpoint) => checkpoint.run_id === expected.runId)
  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.kind).sort(),
    ["after", "before"],
    "Exact before and after checkpoints required",
  )
  assert(checkpoints.some((checkpoint) => checkpoint.id === run.before_checkpoint_id))
  assert(checkpoints.some((checkpoint) => checkpoint.id === run.after_checkpoint_id))
  assert(checkpoints.every((checkpoint) => samePath(checkpoint.worktree_path, expected.cwd)))
  const manifest = state.manifests.filter(
    (entry) => entry.run_id === expected.runId && entry.change_type !== "none",
  )
  assert.equal(manifest.length, 1, "Exact coding file manifest required")
  assert.equal(manifest[0].file_path.replaceAll("\\", "/"), expected.filePath)
  assert(manifest[0].additions > 0, "Coding manifest additions required")
  assert(manifest[0].after_hash, "Coding manifest after hash required")
}

function successfulActivity(event) {
  if (event.phase !== "completed") return false
  const state = String(JSON.parse(event.payload_json).state ?? "completed").toLowerCase()
  return !["failed", "error", "denied", "cancelled", "canceled"].includes(state)
}

function matchingPath(value, expected) {
  if (typeof value !== "string") return false
  const normalized = value.replaceAll("\\", "/")
  return normalized === expected || normalized.endsWith(`/${expected}`)
}

function assertRun(state, expected, permissionMode) {
  const run = state.runs.find((row) => row.id === expected.runId)
  assert(run, "Exact run required")
  assert.equal(run.status, "success")
  assert.equal(run.harness, expected.harness)
  assert.equal(run.model, expected.model)
  assert.equal(run.runtime_preference, expected.harness)
  assert.equal(run.resolved_runtime, expected.harness)
  assert.equal(run.permission_mode, permissionMode)
  assert.equal(JSON.parse(run.runtime_control_snapshot).modelEffort, expected.effort)
  assert(run.runtime_adapter_version && run.runtime_protocol_version, "Runtime versions required")
  const events = state.activity.filter((event) => event.run_id === expected.runId)
  const payloads = events.map((event) => JSON.parse(event.payload_json))
  assert(
    events.some((event) => event.provider_session_id),
    "Provider session required",
  )
  assert(
    events.some((event) =>
      expected.harness === "codex"
        ? event.provider_turn_id
        : event.provider_message_id &&
          event.kind === "lifecycle" &&
          JSON.parse(event.payload_json).state === "result:success",
    ),
    "Authoritative provider turn/result identity required",
  )
  assert(
    !payloads.some((payload) => payload.code === "model-rerouted"),
    "Provider model rerouting prohibited",
  )
  return { run, events, payloads }
}

function assertProviderIdentity(expected, payloads, permissionMode) {
  if (expected.harness === "claude-code") {
    const initialized = payloads.find((payload) => payload.state === "session-initialized")
    assert(initialized, "Claude provider initialization evidence required")
    const detail = JSON.parse(initialized.detail)
    assert.equal(detail.model, expected.model, "Claude provider must report the requested model")
    assert.deepEqual(detail.mcpServers, [], "Claude provider must report no loaded MCP servers")
    if (permissionMode)
      assert.equal(
        detail.permissionMode,
        permissionMode,
        "Claude provider must report the requested permission mode",
      )
  }
}

function assertTranscript(state, expected, run) {
  const messages = JSON.parse(state.subChats.find((row) => row.id === expected.subChatId).messages)
  const messageOffset = expected.messageOffset ?? 0
  assert.equal(messages.length, messageOffset + 2, "Exact prompt and reply history required")
  assert.equal(messages[messageOffset].role, "user")
  assert.equal(messages[messageOffset].id, run.prompt_message_id)
  assert.equal(
    messages[messageOffset].parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    expected.prompt,
  )
  assert.equal(messages[messageOffset + 1].role, "assistant")
  assert.equal(messages[messageOffset + 1].metadata.runId, expected.runId)
  assert.equal(
    messages[messageOffset + 1].parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    expected.nonce,
  )
}

export function assertCancelled(state, expected) {
  const run = state.runs.find((row) => row.id === expected.runId)
  assert(run, "Exact cancellation run required")
  assert.equal(run.status, "cancelled")
  assert.equal(run.harness, expected.harness)
  assert.equal(run.model, expected.model)
  assert.equal(run.permission_mode, "read-only")
  const events = state.activity.filter((event) => event.run_id === expected.runId)
  assert(
    events.some((event) => event.provider_session_id),
    "Provider session required before cancel",
  )
  assert(
    events.some((event) =>
      expected.harness === "codex"
        ? event.provider_turn_id
        : event.kind === "agent-text" && event.provider_message_id,
    ),
    "Provider turn evidence required before cancel",
  )
  assert(
    !events.some((event) => ["tool", "command", "patch"].includes(event.kind)),
    "Cancelled qualification may not use tools",
  )
}

export function assertRestart(before, after) {
  assert.deepEqual(after.runs, before.runs, "Restart must not replay or mutate runs")
  assert.deepEqual(after.activity, before.activity, "Restart must preserve exact provider activity")
  assert.deepEqual(
    after.subChats.map(({ id, messages }) => ({ id, messages })),
    before.subChats.map(({ id, messages }) => ({ id, messages })),
    "Restart must preserve exact transcript",
  )
  assert.deepEqual(
    after.checkpoints ?? [],
    before.checkpoints ?? [],
    "Restart must preserve checkpoints",
  )
  assert.deepEqual(after.manifests ?? [], before.manifests ?? [], "Restart must preserve manifests")
}

export async function main() {
  const executable = resolve(
    process.argv[2] ?? "release-preview/win-unpacked/Flapstack Preview.exe",
  )
  const resources = join(dirname(executable), "resources")
  // Check authorization before touching the package or allocating a profile.
  assert.equal(
    process.env.FLAPSTACK_RUN_PACKAGED_NATIVE_QUALIFICATION,
    "1",
    "Set FLAPSTACK_RUN_PACKAGED_NATIVE_QUALIFICATION=1 to authorize bounded live turns",
  )
  const provenance = JSON.parse(readFileSync(join(resources, "package-provenance.json"), "utf8"))
  validateQualification({
    env: process.env,
    platform: process.platform,
    nodeVersion: process.versions.node,
    executable,
    provenance,
  })
  const require = createRequire(import.meta.url)
  const { _electron } = require(process.env.FLAPSTACK_QUALIFICATION_PLAYWRIGHT || "playwright")
  const sourceCodexAuth = join(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
    "auth.json",
  )
  const sourceClaudeCredentials = join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
    ".credentials.json",
  )
  assert(existsSync(sourceCodexAuth), "Existing Codex authentication required")
  assert(existsSync(sourceClaudeCredentials), "Existing Claude authentication required")
  assertCredentialFreshness(sourceCodexAuth, sourceClaudeCredentials)
  const ownedRoot = mkdtempSync(join(tmpdir(), "flapstack-native-qualification-"))
  const projectPath = join(ownedRoot, "project with spaces")
  mkdirSync(projectPath)
  initializeQualificationRepository(projectPath)
  const identity = `${process.pid}-${Date.now().toString(36)}`
  const codexHome = join(ownedRoot, "codex-home")
  mkdirSync(codexHome)
  const isolatedCodexAuth = join(codexHome, "auth.json")
  const claudeConfigDir = join(ownedRoot, "claude-config")
  mkdirSync(claudeConfigDir)
  const isolatedClaudeCredentials = join(claudeConfigDir, ".credentials.json")
  const env = childEnvironment(process.env, identity, codexHome, claudeConfigDir)
  const profilePath = join(ownedRoot, `Flapstack Preview preview-bridge-${identity}`)
  const output = resolve(".local-evidence", `packaged-native-${identity}`)
  mkdirSync(output, { recursive: true })
  const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
  const credentials = [
    {
      label: "codex",
      source: sourceCodexAuth,
      isolated: isolatedCodexAuth,
      originalSha256: sha256(sourceCodexAuth),
    },
    {
      label: "claude",
      source: sourceClaudeCredentials,
      isolated: isolatedClaudeCredentials,
      originalSha256: sha256(sourceClaudeCredentials),
    },
  ]
  const evidenceFiles = {
    executable,
    appAsar: join(resources, "app.asar"),
    codex: join(resources, "bin", "codex.exe"),
    claude: join(resources, "bin", "claude.exe"),
    betterSqlite3: join(
      resources,
      "app.asar.unpacked",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
  }
  for (const path of Object.values(evidenceFiles))
    assert(existsSync(path), "Runtime artifact missing")
  const report = {
    status: "running",
    surface: "hidden-window",
    ownedRoot,
    runtimeSha256: Object.fromEntries(
      Object.entries(evidenceFiles).map(([name, path]) => [name, sha256(path)]),
    ),
    checks: [],
  }
  let app,
    page,
    activeRunId,
    rendererErrors = 0
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const bounded = (promise, ms = 30000) => {
    let timer
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Qualification deadline exceeded")), ms)
      }),
    ]).finally(() => clearTimeout(timer))
  }
  async function waitForState(predicate, ms = 30000) {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const snapshot = await state()
      if (predicate(snapshot)) return snapshot
      await pause(100)
    }
    throw new Error("Qualification state deadline exceeded")
  }
  async function resolvePendingApprovals(runId, launch, answer, expected, timeoutMs = 180000) {
    const requests = []
    const acceptedKinds = new Set()
    let settled = false
    let launchError = null
    void launch.then(
      () => {
        settled = true
      },
      (error) => {
        launchError = error
        settled = true
      },
    )
    const deadline = Date.now() + timeoutMs
    while (!settled && Date.now() < deadline) {
      const pending = (await rpc("agentInput.list")).filter(
        (request) =>
          request.runId === runId && !requests.some((seen) => seen.requestId === request.requestId),
      )
      for (const request of pending) {
        requests.push(request)
        const kind = qualificationApprovalKind(request, expected)
        const allowed = expected.kinds.includes(kind) && !acceptedKinds.has(kind)
        if (allowed) acceptedKinds.add(kind)
        const response = await rpc(
          "agentInput.respond",
          {
            requestId: request.requestId,
            mode: "structured",
            answers: { permission: [allowed ? answer : "Deny"] },
            submittedAt: Date.now(),
          },
          "mutation",
        )
        assert.equal(response.ok, true, "Pending provider approval must resolve exactly once")
      }
      if (!settled) await pause(100)
    }
    if (!settled) throw new Error(`Timed out resolving approvals for ${runId}`)
    if (launchError) throw launchError
    await launch
    assertQualificationApprovals(requests, expected)
    return requests
  }
  async function start() {
    app = await _electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${join(ownedRoot, "seed")}`, projectPath],
      cwd: projectPath,
      env,
      timeout: 60000,
    })
    page = await bounded(app.firstWindow())
    page.on("pageerror", () => {
      rendererErrors++
    })
    await page.waitForLoadState("domcontentloaded")
    const identity = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      profile: app.getPath("userData"),
      hidden: BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
    }))
    assert.equal(identity.packaged, true)
    assert.equal(
      samePath(identity.profile, profilePath),
      true,
      "Owned temporary profile required before provider launch",
    )
    assert.equal(identity.hidden, true)
    assert(
      !existsSync(join(profilePath, "dev-test-control-mcp.json")),
      "Packaged test control must remain disabled",
    )
    await page.evaluate(() => {
      const pending = new Map()
      let sequence = 700000
      window.electronTRPC.onMessage((response) => {
        const request = pending.get(response.id)
        if (!request) return
        if (response.error) {
          request.reject(new Error("Production RPC rejected qualification"))
          pending.delete(response.id)
        } else if (response.result?.type === "data" && !request.subscription) {
          request.resolve(response.result.data?.json ?? response.result.data)
          pending.delete(response.id)
        } else if (response.result?.type === "stopped") {
          request.resolve()
          pending.delete(response.id)
        }
      })
      window.qualificationRpc = (path, input, type) =>
        new Promise((resolve, reject) => {
          const id = ++sequence
          pending.set(id, { resolve, reject, subscription: type === "subscription" })
          window.electronTRPC.sendMessage({
            method: "request",
            operation: { id, type, path, input: { json: input }, context: {} },
          })
        })
    })
  }
  const rpc = (path, input, type = "query") =>
    bounded(
      page.evaluate(({ path, input, type }) => window.qualificationRpc(path, input, type), {
        path,
        input,
        type,
      }),
      type === "subscription" ? 180000 : 30000,
    )
  const state = () =>
    bounded(
      app.evaluate(({ app }) => {
        const require = process
          .getBuiltinModule("module")
          .createRequire(app.getAppPath() + "/package.json")
        const db = new (require("better-sqlite3"))(app.getPath("userData") + "/data/agents.db", {
          readonly: true,
        })
        try {
          return {
            runs: db.prepare("SELECT * FROM agent_runs ORDER BY id").all(),
            subChats: db.prepare("SELECT * FROM sub_chats ORDER BY id").all(),
            activity: db.prepare("SELECT * FROM agent_activity_events ORDER BY storage_id").all(),
            checkpoints: db.prepare("SELECT * FROM checkpoints ORDER BY id").all(),
            manifests: db.prepare("SELECT * FROM file_change_manifests ORDER BY id").all(),
          }
        } finally {
          db.close()
        }
      }),
    )
  async function close() {
    if (!app) return
    const child = app.process()
    assert(Number.isInteger(child.pid), "Owned app process identity required")
    const processTree = windowsProcessTree(child.pid)
    let closeError = null
    try {
      await bounded(app.close(), 20000)
    } catch (error) {
      closeError = error
    }
    app = null
    const forced = await settleOwnedProcessTree(processTree, closeError ? 0 : 5000)
    if (closeError) throw closeError
    if (forced) throw new Error("Owned provider process required forced termination")
  }
  try {
    for (const credential of credentials) copyFileSync(credential.source, credential.isolated)
    await start()
    const onboarding = page.getByRole("button", {
      name: "Continue without a cloud provider",
      exact: true,
    })
    if (await onboarding.isVisible()) await onboarding.click()
    await rpc("projects.openLaunchDirectory", undefined, "mutation")
    const project = (await rpc("projects.list")).find((project) =>
      samePath(project.path, projectPath),
    )
    assert(project, "Only the owned synthetic project may be used")
    const codingContinuations = []
    for (const spec of qualificationCases) {
      report.phase = `qualifying-${spec.harness}`
      const extensions = (await rpc("providerExtensions.list", { cwd: projectPath })).filter(
        (entry) => entry.provider === spec.provider && entry.kind === "mcp",
      )
      for (const extension of extensions)
        await rpc(
          "providerExtensions.setEnablementPolicy",
          {
            extensionId: extension.id,
            cwd: projectPath,
            location: { type: "project", projectId: project.id },
            enabled: false,
          },
          "mutation",
        )
      const policies = (
        await rpc("providerExtensions.getResolvedState", {
          cwd: projectPath,
          projectId: project.id,
        })
      ).filter(
        (entry) => entry.extension.provider === spec.provider && entry.extension.kind === "mcp",
      )
      assert.equal(policies.length, extensions.length)
      assert(
        policies.every(
          (entry) => entry.resolved.support === "supported" && entry.resolved.enabled === false,
        ),
        "Every discovered MCP server must be disabled",
      )
      const chat = await rpc(
        "chats.create",
        {
          projectId: project.id,
          name: `Qualification ${spec.harness}`,
          harness: spec.harness,
          model: spec.model,
          runtimePreference: spec.harness,
          permissionMode: "read-only",
          useWorktree: false,
          mode: "write",
        },
        "mutation",
      )
      const expected = {
        ...spec,
        runId: randomUUID(),
        subChatId: chat.subChats[0].id,
        nonce: `QUALIFIED-${randomBytes(12).toString("hex")}`,
      }
      expected.prompt = `Do not use tools, read files, run commands, delegate, or contact services. Reply with exactly ${expected.nonce}.`
      activeRunId = expected.runId
      await rpc(
        "agentRuntimeChat.launch",
        {
          chatId: chat.id,
          subChatId: expected.subChatId,
          harness: spec.harness,
          model: spec.model,
          mode: "write",
          reasoningEffort: spec.effort,
          reasoningEnabled: true,
          runId: expected.runId,
          prompt: expected.prompt,
        },
        "subscription",
      )
      const completed = await state()
      assertCompleted(completed, expected)
      const providerSessionId = completed.activity.find(
        (event) => event.run_id === expected.runId && event.provider_session_id,
      )?.provider_session_id
      assert(providerSessionId, "Completed provider session required")
      activeRunId = null
      report.checks.push({
        harness: spec.harness,
        model: spec.model,
        effort: spec.effort,
        disabledMcpCount: extensions.length,
        completed: true,
      })

      const continuation = {
        ...spec,
        runId: randomUUID(),
        subChatId: expected.subChatId,
        nonce: `CONTINUED-${randomBytes(12).toString("hex")}`,
        messageOffset: 2,
      }
      continuation.prompt = `Continue this same conversation. Do not use tools, read files, run commands, delegate, or contact services. Reply with exactly ${continuation.nonce}.`
      activeRunId = continuation.runId
      await rpc(
        "agentRuntimeChat.launch",
        {
          chatId: chat.id,
          subChatId: continuation.subChatId,
          harness: spec.harness,
          model: spec.model,
          mode: "write",
          reasoningEffort: spec.effort,
          reasoningEnabled: true,
          runId: continuation.runId,
          prompt: continuation.prompt,
        },
        "subscription",
      )
      const continued = await state()
      assertCompleted(continued, continuation)
      const continuationSessionIds = new Set(
        continued.activity
          .filter((event) => event.run_id === continuation.runId && event.provider_session_id)
          .map((event) => event.provider_session_id),
      )
      assert.deepEqual(
        [...continuationSessionIds],
        [providerSessionId],
        "Follow-up must resume the exact provider session",
      )
      activeRunId = null
      report.checks.at(-1).continued = true

      const cancellation = {
        ...spec,
        runId: randomUUID(),
        subChatId: expected.subChatId,
        prompt:
          "Do not use tools, read files, run commands, delegate, or contact services. Produce a very long plain-text response by repeating the word WAIT.",
      }
      activeRunId = cancellation.runId
      let launchError
      const launch = rpc(
        "agentRuntimeChat.launch",
        {
          chatId: chat.id,
          subChatId: cancellation.subChatId,
          harness: spec.harness,
          model: spec.model,
          mode: "write",
          reasoningEffort: spec.effort,
          reasoningEnabled: true,
          runId: cancellation.runId,
          prompt: cancellation.prompt,
        },
        "subscription",
      ).catch((error) => {
        launchError = error
      })
      await waitForState((snapshot) => {
        if (launchError) throw launchError
        return snapshot.activity.some(
          (event) =>
            event.run_id === cancellation.runId &&
            (spec.harness === "codex"
              ? event.provider_turn_id
              : event.kind === "agent-text" && event.provider_message_id),
        )
      }, 60000)
      if (launchError) throw launchError
      await rpc("agentRuntimeChat.cancel", { runId: cancellation.runId }, "mutation")
      await launch
      const cancelled = await waitForState((snapshot) =>
        snapshot.runs.some((run) => run.id === cancellation.runId && run.status !== "running"),
      )
      assertCancelled(cancelled, cancellation)
      const cancellationSessionIds = new Set(
        cancelled.activity
          .filter((event) => event.run_id === cancellation.runId && event.provider_session_id)
          .map((event) => event.provider_session_id),
      )
      assert.deepEqual(
        [...cancellationSessionIds],
        [providerSessionId],
        "Cancellation must use the exact continued provider session",
      )
      activeRunId = null
      report.checks.at(-1).cancelled = true

      const codingChat = await rpc(
        "chats.create",
        {
          projectId: project.id,
          name: `Coding qualification ${spec.harness}`,
          harness: spec.harness,
          model: spec.model,
          runtimePreference: spec.harness,
          permissionMode: "full-access",
          useWorktree: false,
          mode: "write",
        },
        "mutation",
      )
      const coding = {
        ...spec,
        runId: randomUUID(),
        subChatId: codingChat.subChats[0].id,
        nonce: `CODED-${randomBytes(12).toString("hex")}`,
        filePath: `${spec.harness}-proof.txt`,
        cwd: projectPath,
      }
      coding.fileContent = `${coding.nonce}\n`
      coding.prompt =
        `Work only in the current qualification repository. Use a file-editing tool, not shell redirection, to replace the contents of ${coding.filePath} with exactly this UTF-8 content including its final newline:\n${coding.fileContent}` +
        `Then use a shell command to run git diff --check -- ${coding.filePath}. Do not commit. After both succeed, reply with exactly ${coding.nonce}.`
      activeRunId = coding.runId
      await rpc(
        "agentRuntimeChat.launch",
        {
          chatId: codingChat.id,
          subChatId: coding.subChatId,
          harness: spec.harness,
          model: spec.model,
          mode: "write",
          reasoningEffort: spec.effort,
          reasoningEnabled: true,
          runId: coding.runId,
          prompt: coding.prompt,
        },
        "subscription",
      )
      const coded = await state()
      assertCodingCompleted(coded, coding)
      assert.equal(readFileSync(join(projectPath, coding.filePath), "utf8"), coding.fileContent)
      assert.doesNotThrow(() =>
        execFileSync("git", ["-C", projectPath, "diff", "--check", "--", coding.filePath], {
          windowsHide: true,
        }),
      )
      const codingDiff = execFileSync("git", ["-C", projectPath, "diff", "--", coding.filePath], {
        encoding: "utf8",
        windowsHide: true,
      })
      assert(codingDiff.includes(coding.nonce), "Git diff must contain the coding proof")
      const codingSessionId = coded.activity.find(
        (event) => event.run_id === coding.runId && event.provider_session_id,
      )?.provider_session_id
      assert(codingSessionId, "Coding provider session required")
      codingContinuations.push({
        coding,
        chatId: codingChat.id,
        providerSessionId: codingSessionId,
      })
      activeRunId = null
      report.checks.at(-1).coded = true
    }

    report.phase = "approval-deny-allow"
    const approvalFilePath = "approval-proof.txt"
    const approvalAbsolutePath = join(projectPath, approvalFilePath)
    const approvalCommand = `git diff --check -- ${approvalFilePath}`
    const approvalExpectation = {
      filePath: approvalAbsolutePath,
      command: approvalCommand,
    }
    const approvalChat = await rpc(
      "chats.create",
      {
        projectId: project.id,
        name: "Approval qualification Claude",
        harness: "claude-code",
        model: "claude-opus-5-5",
        runtimePreference: "claude-code",
        permissionMode: "ask-before-edits",
        useWorktree: false,
        mode: "write",
      },
      "mutation",
    )
    const approvalSubChatId = approvalChat.subChats[0].id
    const deniedRunId = randomUUID()
    const deniedNonce = `DENIED-${randomBytes(12).toString("hex")}`
    const deniedPrompt =
      `Use the Write tool to replace ${approvalAbsolutePath} with DENIED-WRITE followed by a newline. ` +
      `If permission is denied, do not try another tool or method; reply with exactly ${deniedNonce}.`
    activeRunId = deniedRunId
    const deniedLaunch = rpc(
      "agentRuntimeChat.launch",
      {
        chatId: approvalChat.id,
        subChatId: approvalSubChatId,
        harness: "claude-code",
        model: "claude-opus-5-5",
        mode: "write",
        reasoningEffort: "high",
        reasoningEnabled: true,
        runId: deniedRunId,
        prompt: deniedPrompt,
      },
      "subscription",
    )
    const deniedRequests = await resolvePendingApprovals(deniedRunId, deniedLaunch, "Deny", {
      ...approvalExpectation,
      kinds: ["edit"],
    })
    assert.equal(
      qualificationApprovalKind(deniedRequests[0], approvalExpectation),
      "edit",
      "Denied approval must preview the exact file path",
    )
    const denied = await state()
    const deniedRun = denied.runs.find((run) => run.id === deniedRunId)
    assert.equal(deniedRun?.status, "success")
    assert.equal(deniedRun?.permission_mode, "ask-before-edits")
    assert.equal(readFileSync(approvalAbsolutePath, "utf8"), "BASELINE\n")
    assert(
      denied.activity.some((event) => event.run_id === deniedRunId && event.kind === "tool"),
      "Denied run must retain its attempted tool activity",
    )
    const deniedSessionId = denied.activity.find(
      (event) => event.run_id === deniedRunId && event.provider_session_id,
    )?.provider_session_id
    assert(deniedSessionId, "Denied provider session required")
    activeRunId = null

    const approvedRunId = randomUUID()
    const approvedNonce = `APPROVED-${randomBytes(12).toString("hex")}`
    const approvedContent = `${approvedNonce}\n`
    const approvedPrompt =
      `Continue this same conversation. Use the Write tool to replace ${approvalAbsolutePath} with exactly ${approvedContent}` +
      `Then use the Bash tool to run exactly ${approvalCommand} from the current repository. ` +
      `After both approved actions succeed, reply with exactly ${approvedNonce}.`
    activeRunId = approvedRunId
    const approvedLaunch = rpc(
      "agentRuntimeChat.launch",
      {
        chatId: approvalChat.id,
        subChatId: approvalSubChatId,
        harness: "claude-code",
        model: "claude-opus-5-5",
        mode: "write",
        reasoningEffort: "high",
        reasoningEnabled: true,
        runId: approvedRunId,
        prompt: approvedPrompt,
      },
      "subscription",
    )
    const approvedRequests = await resolvePendingApprovals(
      approvedRunId,
      approvedLaunch,
      "Allow once",
      { ...approvalExpectation, kinds: ["edit", "command"] },
    )
    assert(
      approvedRequests.some(
        (request) => qualificationApprovalKind(request, approvalExpectation) === "edit",
      ),
      "Approved edit must preview the exact file path",
    )
    assert(
      approvedRequests.some(
        (request) => qualificationApprovalKind(request, approvalExpectation) === "command",
      ),
      "Approved command must preview the exact command",
    )
    const approvedExpected = {
      harness: "claude-code",
      provider: "claude",
      model: "claude-opus-5-5",
      effort: "high",
      runId: approvedRunId,
      subChatId: approvalSubChatId,
      nonce: approvedNonce,
      prompt: approvedPrompt,
      messageOffset: 2,
      cwd: projectPath,
      filePath: approvalFilePath,
      approvalMode: "interactive",
      permissionMode: "ask-before-edits",
      providerPermissionMode: "default",
    }
    const approved = await state()
    assertCodingCompleted(approved, approvedExpected)
    assert.equal(readFileSync(approvalAbsolutePath, "utf8"), approvedContent)
    const approvedSessionIds = new Set(
      approved.activity
        .filter((event) => event.run_id === approvedRunId && event.provider_session_id)
        .map((event) => event.provider_session_id),
    )
    assert.deepEqual(
      [...approvedSessionIds],
      [deniedSessionId],
      "Approval retry must resume session",
    )
    const changeReview = await rpc("runs.getChangeReview", {
      runId: approvedRunId,
      filePath: approvalFilePath,
    })
    assert.equal(changeReview.fileCount, 1)
    assert.equal(changeReview.recoverable, true)
    assert(changeReview.diff?.includes(approvedNonce), "Run diff must contain the approved edit")
    const undo = await rpc("runs.undoChangeSet", { runId: approvedRunId }, "mutation")
    assert.equal(undo.success, true)
    assert.equal(undo.alreadyUndone, false)
    assert.deepEqual(
      undo.files.map((file) => file.replaceAll("\\", "/")),
      [approvalFilePath],
    )
    assert.equal(readFileSync(approvalAbsolutePath, "utf8"), "BASELINE\n")
    activeRunId = null
    report.approval = {
      deniedWithoutWrite: true,
      allowedWithPathAndCommandPreview: true,
      diffReviewed: true,
      undone: true,
    }
    const before = await state()
    assert.equal(before.runs.length, qualificationCases.length * 4 + 2)
    report.persistenceSha256 = createHash("sha256").update(JSON.stringify(before)).digest("hex")
    report.runtimeVersions = before.runs.map((run) => ({
      harness: run.harness,
      adapter: run.runtime_adapter_version,
      protocol: run.runtime_protocol_version,
    }))
    report.phase = "restart"
    await close()
    await start()
    const restartDeadline = Date.now() + 10000
    do {
      assertRestart(before, await state())
      await pause(500)
    } while (Date.now() < restartDeadline)
    for (const context of codingContinuations) {
      const appended = `RESTARTED-${randomBytes(12).toString("hex")}`
      const continuation = {
        ...context.coding,
        runId: randomUUID(),
        nonce: appended,
        prompt:
          `Continue this same conversation after restart. Use a file-editing tool, not shell redirection, to append exactly this line to ${context.coding.filePath}:\n${appended}\n` +
          `Then use a shell command to run git diff --check -- ${context.coding.filePath}. Do not commit. After both succeed, reply with exactly ${appended}.`,
        fileContent: `${context.coding.fileContent}${appended}\n`,
        messageOffset: 2,
      }
      activeRunId = continuation.runId
      await rpc(
        "agentRuntimeChat.launch",
        {
          chatId: context.chatId,
          subChatId: continuation.subChatId,
          harness: continuation.harness,
          model: continuation.model,
          mode: "write",
          reasoningEffort: continuation.effort,
          reasoningEnabled: true,
          runId: continuation.runId,
          prompt: continuation.prompt,
        },
        "subscription",
      )
      const continued = await state()
      assertCodingCompleted(continued, continuation)
      assert.equal(
        readFileSync(join(projectPath, continuation.filePath), "utf8"),
        continuation.fileContent,
      )
      const continuationDiff = execFileSync(
        "git",
        ["-C", projectPath, "diff", "--", continuation.filePath],
        { encoding: "utf8", windowsHide: true },
      )
      assert(
        continuationDiff.includes(appended),
        "Restarted Git diff must contain the coding proof",
      )
      const sessionIds = new Set(
        continued.activity
          .filter((event) => event.run_id === continuation.runId && event.provider_session_id)
          .map((event) => event.provider_session_id),
      )
      assert.deepEqual(
        [...sessionIds],
        [context.providerSessionId],
        "Restart must resume provider session",
      )
      activeRunId = null
      report.checks.find((check) => check.harness === continuation.harness).restartContinued = true
    }
    const afterContinuation = await state()
    assert.equal(afterContinuation.runs.length, qualificationCases.length * 5 + 2)
    report.persistenceSha256 = createHash("sha256")
      .update(JSON.stringify(afterContinuation))
      .digest("hex")
    report.phase = "final-restart"
    await close()
    await start()
    assertRestart(afterContinuation, await state())
    report.phase = "visual-evidence"
    const syntheticChat = page.getByText("Approval qualification Claude", { exact: true }).first()
    assert.equal(await syntheticChat.isVisible(), true, "Target qualification chat must be visible")
    await syntheticChat.click()
    const activePane = page.locator(`[data-active-group][data-active-chat-id="${approvalChat.id}"]`)
    await activePane.waitFor({ state: "visible" })
    await activePane.getByText(approvedNonce, { exact: true }).last().waitFor({ state: "visible" })
    const screenshots = [
      { name: "desktop.png", width: 1440, height: 900 },
      { name: "narrow.png", width: 900, height: 900 },
    ]
    const visualEvidence = []
    for (const screenshot of screenshots) {
      await page.setViewportSize({ width: screenshot.width, height: screenshot.height })
      await pause(500)
      const image = await page.screenshot({ path: join(output, screenshot.name) })
      assertVisualEvidence({
        activeChatId: await activePane.getAttribute("data-active-chat-id"),
        expectedChatId: approvalChat.id,
        visibleText: await activePane.innerText(),
        expectedText: approvedNonce,
        bounds: await activePane.boundingBox(),
        screenshot: image,
      })
      visualEvidence.push({
        ...screenshot,
        bytes: image.length,
        sha256: createHash("sha256").update(image).digest("hex"),
      })
    }
    report.visualEvidence = visualEvidence
    assert.equal(rendererErrors, 0, "Renderer errors invalidate qualification")
    assert(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
      ),
    )
    report.status = "passed"
    report.restartWithoutReplay = true
  } catch {
    report.status = "failed"
    // Never persist provider errors, account discovery or raw activity payloads.
    if (activeRunId && page)
      await rpc("agentRuntimeChat.cancel", { runId: activeRunId }, "mutation").catch(() => {})
    throw new Error(
      `Packaged native qualification failed; sanitized evidence: ${output}; recovery profile: ${profilePath}`,
    )
  } finally {
    try {
      await close()
      report.appExited = true
    } catch {
      report.appExited = false
      report.status = "failed"
    }
    report.rendererErrors = rendererErrors
    // A failed evidence profile may be retained, but never a stale copied credential.
    report.credentialCopiesRemoved = []
    for (const credential of credentials) {
      try {
        const result = cleanupCredentialCopy(credential, sha256)
        if (result === "drift") {
          report.credentialDriftDetected = true
          report.status = "failed"
        } else report.credentialCopiesRemoved.push(credential.label)
      } catch {
        report.credentialCleanupFailed = true
        report.status = "failed"
      }
    }
    // Preserve failed profiles for recovery; remove only this mkdtemp-owned tree after clean exit.
    if (report.status === "passed" && report.appExited) {
      try {
        rmSync(ownedRoot, { recursive: true, force: false })
      } catch {
        report.status = "failed"
        report.cleanupFailed = true
      }
    }
    report.profileRetained = existsSync(ownedRoot)
    writeFileSync(join(output, "result.json"), JSON.stringify(report, null, 2))
  }
  if (
    !report.appExited ||
    report.cleanupFailed ||
    report.credentialCleanupFailed ||
    report.credentialDriftDetected
  )
    throw new Error(`Owned app cleanup incomplete; recovery retained at ${ownedRoot}`)
  console.log(JSON.stringify({ status: report.status, output }))
}

function windowsProcessInventory() {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  ).trim()
  if (!output) return []
  const rows = JSON.parse(output)
  return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
    processId: Number(row.ProcessId),
    parentProcessId: Number(row.ParentProcessId),
    creationDate: String(row.CreationDate),
  }))
}

function windowsProcessTree(rootPid) {
  const inventory = windowsProcessInventory()
  const root = inventory.find((process) => process.processId === rootPid)
  assert(root, "Owned app process must exist before shutdown")
  const tree = new Map([[root.processId, root]])
  let changed = true
  while (changed) {
    changed = false
    for (const process of inventory) {
      if (tree.has(process.parentProcessId) && !tree.has(process.processId)) {
        tree.set(process.processId, process)
        changed = true
      }
    }
  }
  return [...tree.values()]
}

async function settleOwnedProcessTree(owned, graceMs) {
  const matching = () => {
    const inventory = new Map(
      windowsProcessInventory().map((process) => [process.processId, process.creationDate]),
    )
    return owned.filter((process) => inventory.get(process.processId) === process.creationDate)
  }
  const deadline = Date.now() + graceMs
  let remaining = matching()
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    remaining = matching()
  }
  if (!remaining.length) return false
  for (const process of remaining) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(process.processId), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
    } catch {
      // A concurrent exit is acceptable; identity is verified again below.
    }
  }
  const forcedDeadline = Date.now() + 10000
  do {
    remaining = matching()
    if (!remaining.length) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < forcedDeadline)
  throw new Error("Owned process tree did not exit")
}

export function cleanupCredentialCopy(credential, sha256) {
  if (!existsSync(credential.isolated)) throw new Error("Isolated credential missing")
  const isolatedSha256 = sha256(credential.isolated)
  const sourceSha256 = sha256(credential.source)
  if (isolatedSha256 !== credential.originalSha256 && isolatedSha256 !== sourceSha256) {
    return "drift"
  }
  rmSync(credential.isolated, { force: true })
  return "removed"
}

export function assertCredentialFreshness(codexAuthPath, claudeCredentialsPath, now = Date.now()) {
  const codex = JSON.parse(readFileSync(codexAuthPath, "utf8"))
  const accessToken = String(codex?.tokens?.access_token ?? "")
  const payloadPart = accessToken.split(".")[1]
  assert(payloadPart, "Codex access token expiry required")
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"))
  const claude = JSON.parse(readFileSync(claudeCredentialsPath, "utf8"))
  const expiries = [Number(payload.exp) * 1000, Number(claude?.claudeAiOauth?.expiresAt)]
  assert(
    expiries.every((expiry) => Number.isFinite(expiry) && expiry - now >= 30 * 60_000),
    "Provider credentials must remain valid for at least 30 minutes",
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
