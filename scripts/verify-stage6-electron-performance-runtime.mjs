#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensureNativeAbi } from "./ensure-native-abi.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

if (!process.env.FLAPSTACK_STAGE6_ELECTRON_HOSTED) {
  const gitSha = captureCleanCandidateGitSha(root)
  const nodeExecutable = process.execPath
  const electronExecutable = require("electron")
  const applicationBuild = spawnSync(nodeExecutable, [resolve(root, "scripts", "build.mjs")], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  })
  if (applicationBuild.error) throw applicationBuild.error
  if (applicationBuild.status !== 0) {
    throw new Error(`Stage 6 prebuilt application build failed (${applicationBuild.status ?? 1}).`)
  }
  let result
  try {
    const electronAbi = ensureNativeAbi("electron").probe.abi
    result = spawnSync(nodeExecutable, [fileURLToPath(import.meta.url)], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        FLAPSTACK_STAGE6_ELECTRON_HOSTED: "1",
        FLAPSTACK_STAGE6_NODE_EXECUTABLE: nodeExecutable,
        FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE: electronExecutable,
        FLAPSTACK_STAGE6_ELECTRON_ABI: electronAbi,
      },
    })
  } finally {
    ensureNativeAbi("node")
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || "Stage 6 Electron runtime integration failed.")
  }
  if (captureCleanCandidateGitSha(root) !== gitSha) {
    throw new Error("Stage 6 Electron runtime candidate changed during verification.")
  }
  const payload = JSON.parse(result.stdout)
  const evidencePayload = {
    ...payload,
    gitSha,
  }
  const evidence = {
    ...evidencePayload,
    integrity: {
      algorithm: "sha256",
      digest: sha256(JSON.stringify(evidencePayload)),
    },
  }
  const evidencePath = join(
    root,
    ".local-evidence",
    "stage6-performance",
    "stage6-electron-runtime-probe.json",
  )
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  const persisted = JSON.parse(readFileSync(evidencePath, "utf8"))
  const { integrity, ...persistedPayload } = persisted
  if (
    integrity?.algorithm !== "sha256" ||
    integrity.digest !== sha256(JSON.stringify(persistedPayload))
  ) {
    throw new Error("Persisted Stage 6 Electron runtime evidence failed integrity validation.")
  }
  validatePersistedRuntimeEvidence(persistedPayload, gitSha)
  process.stdout.write(
    `${JSON.stringify({
      evidencePath,
      gitSha: persistedPayload.gitSha,
      integritySha256: integrity.digest,
      runs: persistedPayload.runs.map((run) => ({
        id: run.id,
        measuredSample: run.evidence.measuredSamples[0],
        rendererProcessId: run.evidence.sampleRendererProcessIds[0],
      })),
    })}\n`,
  )
} else {
  const probes = [
    {
      id: "cold-shell",
      budgetId: "startup.shell-ready.small.dev.cold",
      action: "observe-cold-shell-ready",
    },
    {
      id: "long-chat",
      budgetId: "renderer.long-chat-render.large.dev.steady",
      action: "render-long-chat-fixture",
    },
    {
      id: "search",
      budgetId: "renderer.search-response.large.dev.steady",
      action: "search-large-fixture",
    },
    {
      id: "four-pane-grid",
      budgetId: "concurrency.grid-input-response.stress.dev.steady",
      action: "dispatch-grid-input-probe",
    },
  ]
  const runs = probes.map((probe) => {
    const orchestrator = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/stage6-electron-supervisor.mjs"),
        probe.budgetId,
        probe.action,
        "0",
        "1",
        root,
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: process.env,
        maxBuffer: 5_000_000,
      },
    )
    if (orchestrator.error) throw orchestrator.error
    if (orchestrator.status !== 0) {
      throw new Error(
        `Exact Electron ${probe.id} probe failed: ${
          orchestrator.stderr || "no error output was returned"
        }`,
      )
    }
    return { ...probe, evidence: JSON.parse(orchestrator.stdout) }
  })
  const payload = {
    schemaVersion: 1,
    nativeAbi: process.env.FLAPSTACK_STAGE6_ELECTRON_ABI,
    nativeAbiAuthority: "ensure-native-abi-electron-probe",
    nativeModules: {
      betterSqlite3: "loaded",
      nodePty: "loaded",
    },
    runs,
  }
  validateRuntimeEvidence(payload)
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function captureCleanCandidateGitSha(repositoryRoot) {
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim()
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  })
  if (!/^[a-f0-9]{40}$/.test(gitSha) || status.length > 0) {
    throw new Error("Stage 6 Electron runtime evidence requires a clean candidate.")
  }
  return gitSha
}

function validatePersistedRuntimeEvidence(payload, expectedGitSha) {
  if (payload?.gitSha !== expectedGitSha || !/^[a-f0-9]{40}$/.test(payload.gitSha)) {
    throw new Error("Persisted Stage 6 Electron runtime evidence has an invalid candidate SHA.")
  }
  validateRuntimeEvidence(payload)
}

function validateRuntimeEvidence(payload) {
  const expectedRuns = new Map([
    ["cold-shell", "startup.shell-ready.small.dev.cold"],
    ["long-chat", "renderer.long-chat-render.large.dev.steady"],
    ["search", "renderer.search-response.large.dev.steady"],
    ["four-pane-grid", "concurrency.grid-input-response.stress.dev.steady"],
  ])
  const expectedFixtures = new Map([
    ["cold-shell", null],
    ["long-chat", { messageCount: 200, paneCount: 1 }],
    ["search", { messageCount: 200, paneCount: 1 }],
    ["four-pane-grid", { messageCount: 1, paneCount: 4 }],
  ])
  if (
    payload?.schemaVersion !== 1 ||
    !/^\d+$/.test(payload.nativeAbi) ||
    payload.nativeAbiAuthority !== "ensure-native-abi-electron-probe" ||
    payload.nativeModules?.betterSqlite3 !== "loaded" ||
    payload.nativeModules?.nodePty !== "loaded" ||
    !Array.isArray(payload.runs) ||
    payload.runs.length !== 4
  ) {
    throw new Error("Stage 6 Electron runtime probe returned incomplete evidence.")
  }
  let stableApplication = null
  let stableExecutable = null
  for (const run of payload.runs) {
    const evidence = run.evidence
    const expectedFixture = expectedFixtures.get(run.id)
    if (
      expectedRuns.get(run.id) !== run.budgetId ||
      evidence?.measuredSamples?.length !== 1 ||
      evidence.warmupSamples?.length !== 0 ||
      evidence.buildIdentities?.length !== 1 ||
      evidence.sampleRendererProcessIds?.length !== 1 ||
      evidence.buildIdentities[0]?.rendererProcessId !== evidence.sampleRendererProcessIds[0] ||
      evidence.buildIdentities[0]?.identitySha256 !== evidence.buildIdentity?.identitySha256 ||
      evidence.orchestrator?.processOwnership !== "verified" ||
      (expectedFixture === null
        ? evidence.orchestrator.fixture !== null
        : evidence.orchestrator.fixture?.messageCount !== expectedFixture?.messageCount ||
          evidence.orchestrator.fixture?.paneCount !== expectedFixture?.paneCount)
    ) {
      throw new Error(`Exact Electron ${run.id} probe returned incomplete provenance.`)
    }
    validateBuildIdentity(evidence.buildIdentities[0])
    stableApplication ??= evidence.buildIdentities[0].applicationSha256
    stableExecutable ??= evidence.buildIdentities[0].executableSha256
    if (
      evidence.buildIdentities[0].applicationSha256 !== stableApplication ||
      evidence.buildIdentities[0].executableSha256 !== stableExecutable
    ) {
      throw new Error("Exact Electron runtime probes did not use one stable application build.")
    }
  }
}

function validateBuildIdentity(identity) {
  const payload = {
    appVersion: identity?.appVersion,
    electronVersion: identity?.electronVersion,
    buildType: identity?.buildType,
    executableSha256: identity?.executableSha256,
    applicationSha256: identity?.applicationSha256,
    rendererProcessId: identity?.rendererProcessId,
  }
  if (
    typeof payload.appVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(payload.electronVersion) ||
    (payload.buildType !== "dev" && payload.buildType !== "package") ||
    !/^[a-f0-9]{64}$/.test(payload.executableSha256) ||
    !/^[a-f0-9]{64}$/.test(payload.applicationSha256) ||
    !Number.isInteger(payload.rendererProcessId) ||
    identity.identitySha256 !== sha256(JSON.stringify(payload))
  ) {
    throw new Error("Exact Electron runtime probe returned an invalid build identity.")
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
