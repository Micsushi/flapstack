import { spawn } from "node:child_process"
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { basename, relative, resolve, sep } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  classifyNativeFlapstackProcesses,
  drainOwnedProcessIds,
  findStage6IsolatedNativeProcessIds,
  killNativeProcess,
  processDescendsFromNative,
  queryNativeProcesses,
} from "./lib/native-processes.mjs"
import {
  flapstackProfilePath,
  electronAppDataRoot,
  resolveDevMcpDescriptorPath,
} from "./lib/profile-paths.mjs"

const [budgetId, action, warmupText, repeatText, rootText] = process.argv.slice(2)
const repositoryRoot = realpathSync(resolve(rootText))
const warmups = boundedCount(warmupText)
const repeats = boundedCount(repeatText)
const timeoutMs = 240_000
const startupAction = action === "observe-cold-shell-ready" || action === "observe-warm-shell-ready"
const firstUseAction = action === "open-first-use" || action === "open-warm-first-use"
const largeFixtureAction =
  action === "render-long-chat-fixture" || action === "search-large-fixture"
const gridAction = action === "dispatch-grid-input-probe"
const fixtureMessageCount = largeFixtureAction ? 200 : 1
const paneCount = gridAction ? 4 : 1
const warmAction = action === "observe-warm-shell-ready" || action === "open-warm-first-use"
const instance = `stage6-perf-${process.pid}-${Date.now().toString(36)}`
const runToken = process.env.FLAPSTACK_STAGE6_RUN_TOKEN
if (!/^s6-\d+-[a-z0-9]+-[a-f0-9]{12}$/.test(runToken ?? "")) {
  throw new Error("Stage 6 exact-process launch requires a bounded supervisor run token.")
}
const profile = `Flapstack Dev ${instance}`
const profilePath = flapstackProfilePath(profile)
const descriptorPath = resolveDevMcpDescriptorPath(profile)
const samples = []
const sampleRendererProcessIds = []
const buildIdentities = []
let stableIdentity = null
let fixture = null
const ownedLaunches = new Set()

try {
  if (firstUseAction) {
    const preparation = await launchExactProcess()
    try {
      fixture = await callTool(preparation.client, "provision_stage6_performance_fixture", {
        messageCount: fixtureMessageCount,
        paneCount,
      })
      await waitForProductReadiness(preparation.client)
      await waitForVisibleTranscript(preparation.client, fixture.subChatId)
    } finally {
      await teardown(preparation)
    }
  }

  if (warmAction && startupAction) {
    const priming = await launchExactProcess()
    await teardown(priming)
  }

  if (warmAction && firstUseAction) {
    const launched = await launchExactProcess()
    try {
      await selectExactFixtureChat(launched.client, fixture.chatId, fixture.subChatId)
      await waitForVisibleTranscript(launched.client, fixture.subChatId)
      for (let index = 0; index < warmups + repeats; index += 1) {
        const observed = await callPerformanceSample(launched.client, false)
        stableIdentity = bindIdentity(stableIdentity, observed.buildIdentity)
        buildIdentities.push(observed.buildIdentity)
        sampleRendererProcessIds.push(observed.buildIdentity.rendererProcessId)
        samples.push(observed.durationMs)
      }
    } finally {
      await teardown(launched)
    }
  } else if (startupAction || firstUseAction) {
    for (let index = 0; index < warmups + repeats; index += 1) {
      const launched = await launchExactProcess()
      try {
        if (firstUseAction) {
          await selectExactFixtureChat(launched.client, fixture.chatId, fixture.subChatId)
        }
        const observed = firstUseAction
          ? await callPerformanceSampleWhenReady(launched, true)
          : await observeShellReady(launched)
        stableIdentity = bindIdentity(stableIdentity, observed.buildIdentity)
        buildIdentities.push(observed.buildIdentity)
        sampleRendererProcessIds.push(observed.buildIdentity.rendererProcessId)
        samples.push(observed.durationMs)
      } finally {
        await teardown(launched)
      }
    }
  } else {
    const launched = await launchExactProcess()
    try {
      fixture = await callTool(launched.client, "provision_stage6_performance_fixture", {
        messageCount: fixtureMessageCount,
        paneCount,
      })
      for (let index = 0; index < warmups + repeats; index += 1) {
        await ensureRepeatedSampleFixtureState(launched, fixture)
        const observed = await callPerformanceSampleWhenReady(launched, false)
        stableIdentity = bindIdentity(stableIdentity, observed.buildIdentity)
        buildIdentities.push(observed.buildIdentity)
        sampleRendererProcessIds.push(observed.buildIdentity.rendererProcessId)
        samples.push(observed.durationMs)
      }
    } finally {
      await teardown(launched)
    }
  }

  process.stdout.write(
    JSON.stringify({
      warmupSamples: samples.slice(0, warmups),
      measuredSamples: samples.slice(warmups),
      buildIdentity: stableIdentity,
      buildIdentities,
      sampleRendererProcessIds,
      orchestrator: {
        authority: "external-exact-process",
        checkout: repositoryRoot,
        profile,
        processOwnership: "verified",
        fixture: fixture
          ? {
              messageCount: fixture.messageCount,
              paneCount: fixture.paneCount,
            }
          : null,
      },
    }),
  )
} finally {
  await cleanupAllOwned()
  await removeIsolatedProfile()
}

async function launchExactProcess() {
  if (!["win32", "darwin", "linux"].includes(process.platform)) {
    throw new Error(
      `Stage 6 exact-process Electron orchestration is unsupported on ${process.platform}.`,
    )
  }
  const nodeExecutable = realpathSync(resolve(process.env.FLAPSTACK_STAGE6_NODE_EXECUTABLE || ""))
  const electronExecutable = realpathSync(
    resolve(process.env.FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE || ""),
  )
  const electronRoot = realpathSync(resolve(repositoryRoot, "node_modules", "electron", "dist"))
  const electronRelationship = relative(electronRoot, electronExecutable)
  if (
    !process.env.FLAPSTACK_STAGE6_ELECTRON_HOSTED ||
    nodeExecutable !== realpathSync(process.execPath) ||
    electronExecutable === nodeExecutable ||
    !electronRelationship ||
    electronRelationship.startsWith(`..${sep}`) ||
    resolve(electronRoot, electronRelationship) !== electronExecutable
  ) {
    throw new Error(
      "Stage 6 exact-process launch requires exact distinct Node and repository Electron runtimes.",
    )
  }
  const startedAt = performance.now()
  const launchedAtEpoch = Date.now()
  for (const relativePath of [
    "out/main/index.js",
    "out/preload/index.js",
    "out/renderer/index.html",
  ]) {
    if (!existsSync(resolve(repositoryRoot, relativePath))) {
      throw new Error(`Stage 6 prebuilt application entry is missing: ${relativePath}`)
    }
  }
  const launchEnv = {
    ...process.env,
    FLAPSTACK_DEV_CHECKOUT: repositoryRoot,
    FLAPSTACK_DEV_INSTANCE: instance,
    FLAPSTACK_DEV_MCP_PROFILE: profile,
    FLAPSTACK_KEEP_RENDERER_ACTIVE: "1",
    FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1",
  }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  delete launchEnv.ELECTRON_RENDERER_URL
  const child = spawn(electronExecutable, [repositoryRoot, `--flapstack-stage6-run=${runToken}`], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: launchEnv,
  })
  let childOutput = ""
  const appendChildOutput = (chunk) => {
    childOutput = `${childOutput}${String(chunk)}`.slice(-20_000)
  }
  child.stdout.on("data", appendChildOutput)
  child.stderr.on("data", appendChildOutput)
  const readChildOutput = () => childOutput.trim()
  const owned = {
    child,
    client: null,
    descriptor: null,
    descriptorCreationDate: null,
    launchedAtEpoch,
    startedAt,
  }
  ownedLaunches.add(owned)
  const descriptor = await waitForDescriptor(child, launchedAtEpoch, readChildOutput)
  owned.descriptor = descriptor
  owned.descriptorCreationDate = await verifyOwnedProcess(child.pid, descriptor)
  const client = await connect(descriptor)
  owned.client = client
  await callTool(client, "get_test_environment", {})
  await waitForRendererControlReady(client)
  return owned
}

async function waitForDescriptor(child, launchedAtEpoch, readChildOutput) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let hasOwnedDescendant = false
    if (child.exitCode !== null) {
      const processes = queryNativeProcesses()
      hasOwnedDescendant = processes.some(
        (entry) =>
          Number(entry.ProcessId) !== child.pid &&
          processDescendsFromNative(processes, Number(entry.ProcessId), child.pid),
      )
    }
    if (child.exitCode !== null && !hasOwnedDescendant) {
      const output = readChildOutput()
      throw new Error(
        `Stage 6 Electron process exited before readiness${output ? `:\n${output}` : "."}`,
      )
    }
    if (existsSync(descriptorPath)) {
      const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"))
      if (
        descriptor.profile === profile &&
        realpathSync(descriptor.checkout) === repositoryRoot &&
        Number.isInteger(descriptor.pid) &&
        descriptor.pid > 0 &&
        Date.parse(descriptor.startedAt) >= launchedAtEpoch - 1_000
      ) {
        return descriptor
      }
    }
    await pollTick()
  }
  const output = readChildOutput()
  throw new Error(`Stage 6 Electron descriptor readiness timed out${output ? `:\n${output}` : "."}`)
}

async function verifyOwnedProcess(launcherPid, descriptor) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const processes = queryNativeProcesses()
    const classification = classifyNativeFlapstackProcesses(processes, {
      root: repositoryRoot,
      profilePath,
    })
    if (
      classification.rendererPid &&
      processDescendsFromNative(processes, descriptor.pid, launcherPid)
    ) {
      const descriptorProcess = processes.find(
        (entry) => Number(entry.ProcessId) === Number(descriptor.pid),
      )
      if (descriptorProcess?.CreationDate) return String(descriptorProcess.CreationDate)
    }
    await pollTick()
  }
  throw new Error("Stage 6 Electron descriptor process is not owned by the exact launcher.")
}

async function connect(descriptor) {
  const client = new Client({ name: "flapstack-stage6-startup", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${descriptor.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  })
  await client.connect(transport)
  return client
}

async function observeShellReady(launched) {
  await waitForProductReadiness(launched.client)
  const response = await callTool(launched.client, "control_electron_performance_measurement", {
    budgetId,
    action,
    operation: "read",
  })
  return {
    durationMs: performance.now() - launched.startedAt,
    buildIdentity: response.buildIdentity,
  }
}

async function waitForRendererControlReady(client) {
  const deadline = Date.now() + timeoutMs
  let lastWarning = "renderer control bridge has not responded"
  while (Date.now() < deadline) {
    const state = await callTool(client, "get_settings_state", {})
    if (state.renderer && !state.rendererWarning) return
    lastWarning =
      typeof state.rendererWarning === "string" && state.rendererWarning
        ? state.rendererWarning
        : lastWarning
    await pollTick()
  }
  throw new Error(`Stage 6 renderer control readiness timed out: ${lastWarning}`)
}

async function callPerformanceSample(client, includeLaunch, startedAt = 0) {
  const response = await callTool(client, "control_electron_performance_measurement", {
    budgetId,
    action,
    operation: "sample",
  })
  const durationMs = includeLaunch ? performance.now() - startedAt : response.state?.durationMs
  if (!Number.isFinite(durationMs) || durationMs < 0 || !response.buildIdentity) {
    throw new Error("Stage 6 Electron process returned an invalid observed sample.")
  }
  return { durationMs, buildIdentity: response.buildIdentity }
}

async function callPerformanceSampleWhenReady(launched, includeLaunch) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await callPerformanceSample(
        launched.client,
        includeLaunch,
        includeLaunch ? launched.startedAt : 0,
      )
    } catch (error) {
      lastError = error
      if (!isRetryableRendererReadinessError(error)) throw error
      await pollTick()
    }
  }
  throw new Error(
    `Stage 6 product sample readiness timed out: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

function isRetryableRendererReadinessError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /requires a visible|requires an actual product transcript|requires four open product chats|grid setup|search input/i.test(
    message,
  )
}

async function waitForProductReadiness(client) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await callTool(client, "control_electron_performance_measurement", {
        budgetId,
        action,
        operation: "read",
      })
      return
    } catch {
      await pollTick()
    }
  }
  throw new Error("Stage 6 product renderer readiness timed out.")
}

async function waitForVisibleTranscript(client, subChatId) {
  if (typeof subChatId !== "string" || !subChatId) {
    throw new Error("Stage 6 transcript readiness requires the exact provisioned sub-chat.")
  }
  await callTool(client, "get_visible_copy_search_state", { subChatId })
}

async function ensureRepeatedSampleFixtureState(launched, fixture) {
  if (gridAction) {
    for (let index = 0; index < fixture.chatIds.length; index += 1) {
      await selectExactFixtureChat(
        launched.client,
        fixture.chatIds[index],
        fixture.subChatIds[index],
      )
    }
  } else {
    await selectExactFixtureChat(launched.client, fixture.chatId, fixture.subChatId)
  }
  await waitForProductReadiness(launched.client)
  await waitForVisibleTranscript(
    launched.client,
    gridAction ? fixture.subChatIds.at(-1) : fixture.subChatId,
  )
}

async function selectExactFixtureChat(client, chatId, subChatId) {
  if (typeof chatId !== "string" || !chatId || typeof subChatId !== "string" || !subChatId) {
    throw new Error("Stage 6 fixture selection requires exact provisioned chat identities.")
  }
  const selected = await callTool(client, "select_test_chat", { chatId, subChatId })
  if (selected.chatId !== chatId || selected.subChatId !== subChatId) {
    throw new Error("Stage 6 renderer did not acknowledge the exact fixture chat selection.")
  }
}

async function callTool(client, name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, {
    timeout: timeoutMs,
  })
  if (response.isError) {
    const content = response.content
    throw new Error(content?.find((entry) => entry.type === "text")?.text || `${name} failed.`)
  }
  const result = response.structuredContent?.result
  if (!result || typeof result !== "object") throw new Error(`${name} returned no result.`)
  return result
}

async function teardown(launched) {
  await launched.client?.close().catch(() => undefined)
  const drained = await drainOwnedProcessIds({
    findOwned: () => findRemainingOwnedProcesses(launched),
    kill: (pid) => killNativeProcess(pid, { force: true }),
    wait: pollTick,
  })
  if (drained.stable) {
    ownedLaunches.delete(launched)
    return
  }
  throw new Error(
    `Stage 6 Electron owned processes did not reach stable termination (${drained.remaining.join(", ") || "no stable-empty observation"}); taskkill statuses ${drained.killStatuses.slice(-20).join(" | ")}`,
  )
}

function findRemainingOwnedProcesses(launched) {
  return findStage6IsolatedNativeProcessIds(queryNativeProcesses(), {
    root: repositoryRoot,
    profilePath,
    instance,
    runToken,
    launchedAtEpoch: launched.launchedAtEpoch,
    launcherPid: launched.child.pid,
    launcherExited: launched.child.exitCode !== null,
    descriptorPid: launched.descriptor?.pid,
    descriptorCreationDate: launched.descriptorCreationDate,
  })
}

async function cleanupAllOwned() {
  let firstError = null
  for (const launched of [...ownedLaunches]) {
    try {
      await teardown(launched)
    } catch (error) {
      firstError ??= error
    }
  }
  if (ownedLaunches.size > 0) {
    throw firstError ?? new Error("Stage 6 Electron process cleanup remained incomplete.")
  }
}

async function removeIsolatedProfile() {
  const appDataRoot = realpathSync(resolve(electronAppDataRoot()))
  const target = resolve(profilePath)
  const relationship = relative(appDataRoot, target)
  if (
    !relationship ||
    relationship.startsWith(`..${sep}`) ||
    resolve(appDataRoot, relationship) !== target ||
    !/^Flapstack Dev stage6-perf-\d+-[a-z0-9]+$/.test(basename(target))
  ) {
    throw new Error("Refusing to remove a non-isolated Stage 6 performance profile.")
  }
  const deadline = Date.now() + 10_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      rmSync(target, { recursive: true, force: true })
      if (!existsSync(target)) return
    } catch (error) {
      lastError = error
    }
    await pollTick()
  }
  throw lastError ?? new Error("Stage 6 isolated profile cleanup timed out.")
}

function bindIdentity(previous, current) {
  if (!current?.identitySha256) throw new Error("Stage 6 Electron build identity is missing.")
  const processes = queryNativeProcesses()
  if (
    ![...ownedLaunches].some((launched) =>
      processDescendsFromNative(processes, current.rendererProcessId, launched.child.pid),
    )
  ) {
    throw new Error("Stage 6 Electron sample renderer is not owned by the exact launcher.")
  }
  if (
    previous &&
    (previous.appVersion !== current.appVersion ||
      previous.electronVersion !== current.electronVersion ||
      previous.buildType !== current.buildType ||
      previous.executableSha256 !== current.executableSha256 ||
      previous.applicationSha256 !== current.applicationSha256)
  ) {
    throw new Error("Stage 6 Electron build identity changed between exact-process samples.")
  }
  return previous ?? current
}

function boundedCount(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 0 || count > 100) {
    throw new Error("Stage 6 Electron sample count is out of bounds.")
  }
  return count
}

function pollTick() {
  return new Promise((resolveReady) => setTimeout(resolveReady, 100))
}
