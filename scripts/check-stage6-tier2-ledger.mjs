#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(import.meta.dirname, "..")

export const stage6TaskBoardPaths = [
  "polish-product-ui-ux",
  "add-guided-onboarding-visibility",
  "extend-agent-profiles-personalities",
  "add-stage6-mobile-companion",
  "add-visual-context-capture",
  "add-terminal-grid-swarm-workspaces",
  "complete-runtime-orchestration-composition",
  "add-organization-usage-apis",
  "harden-product-performance",
  "add-cross-platform-distribution",
  "add-obsidian-compatible-project-knowledge-graph",
  "validate-stage6-release",
].map((change) => `openspec/changes/${change}/tasks.md`)

const stage6ReleaseOnlyTaskIds = new Set([
  ...Array.from({ length: 8 }, (_, index) => `S6-F10-T${index + 1}`),
  "S6-F11-T2",
])

export function validateStage6Tier2Ledger({ matrix, ledger, expectedCount = 60 }) {
  const matrixIds = [
    ...String(matrix).matchAll(/^\s*-\s*\[[ xX]\]\s*\*\*\[T2-core\]\s+(S6-[A-Z0-9]+)\*\*/gm),
  ].map((match) => match[1])
  const coreMap = section(String(ledger), "## Core row map", "## Open nonblocking overlays")
  const ledgerRows = [...coreMap.matchAll(/^\|\s*(S6-[A-Z0-9]+)\s*\|([^|\n]+)\|([^|\n]+)\|/gm)]
  const ledgerIds = ledgerRows.map((match) => match[1])

  const matrixDuplicates = duplicates(matrixIds)
  if (matrixDuplicates.length) {
    throw new Error(`authoritative matrix has duplicate T2-core IDs: ${matrixDuplicates.join(",")}`)
  }
  if (matrixIds.length !== expectedCount) {
    throw new Error(
      `authoritative matrix T2-core count changed: expected ${expectedCount}, found ${matrixIds.length}`,
    )
  }

  const ledgerDuplicates = duplicates(ledgerIds)
  const matrixSet = new Set(matrixIds)
  const ledgerSet = new Set(ledgerIds)
  const missing = matrixIds.filter((id) => !ledgerSet.has(id))
  const extra = ledgerIds.filter((id) => !matrixSet.has(id))
  if (ledgerDuplicates.length || missing.length || extra.length) {
    throw new Error(
      `Tier 2 ledger mismatch; duplicates=${list(ledgerDuplicates)}; missing=${list(missing)}; extra=${list(extra)}`,
    )
  }
  for (const match of ledgerRows) {
    if (!match[2].trim() || !match[3].trim()) {
      throw new Error(`Tier 2 ledger row ${match[1]} must name evidence and current status`)
    }
  }
  if (!ledger.includes("60/60 `T2-core` matrix rows")) {
    throw new Error("Tier 2 ledger must state the reconciled 60/60 T2-core coverage")
  }

  return { matrixCount: matrixIds.length, ledgerCount: ledgerIds.length, ids: [...matrixIds] }
}

export function validateStage6TaskBoards({
  taskBoards,
  expectedCoreCount = 91,
  expectedReleaseCount = 9,
  expectedPureCoreCount = 50,
  expectedMixedCoreCount = 41,
}) {
  const tasks = []
  for (const board of taskBoards) {
    const path = board.path ?? "unknown"
    const content = String(board.content ?? "")
    const blocks = [
      ...content.matchAll(
        /(^### (S6-F\d+-T\d+)[^\n]*\n[\s\S]*?)(?=^### S6-F\d+-T\d+|(?![\s\S]))/gm,
      ),
    ]
    for (const match of blocks) tasks.push({ path, id: match[2], block: match[1] })
  }

  const ids = tasks.map((task) => task.id)
  const duplicateIds = duplicates(ids)
  if (duplicateIds.length) {
    throw new Error(`Stage 6 task boards have duplicate IDs: ${duplicateIds.join(",")}`)
  }

  const core = []
  const pureCore = []
  const mixedCore = []
  const release = []
  for (const task of tasks) {
    const classLine = /^- Evidence class(?:es)?: (.+)$/m.exec(task.block)?.[1] ?? ""
    const hasCore = classLine.includes("`T2-core`")
    const releaseOnly = classLine === "`release-gate`."
    const capabilityClasses = [...classLine.matchAll(/`(T2-capability:[^`]+)`/g)].map(
      (match) => match[1],
    )
    const hasReleaseOverlay = hasCore && classLine.includes("`release-gate`")
    if (hasCore === releaseOnly || (!hasCore && !releaseOnly)) {
      throw new Error(`${task.id} must declare exactly one core or release-only task scope`)
    }
    if (/^- \[x\] (?:Capability|Release) evidence:/m.test(task.block)) {
      throw new Error(`${task.id} has an incorrectly checked non-core evidence row`)
    }
    if (hasCore) {
      core.push(task.id)
      if (capabilityClasses.length || hasReleaseOverlay) mixedCore.push(task.id)
      else pureCore.push(task.id)
      if (!task.block.includes("- [x] T2-core completion: acceptance and verification passed")) {
        throw new Error(`${task.id} T2-core completion must be checked`)
      }
      for (const capability of capabilityClasses) {
        if (!task.block.includes(`- [ ] Capability evidence: \`${capability}\``)) {
          throw new Error(`${task.id} must keep ${capability} as a separate open row`)
        }
      }
      if (
        hasReleaseOverlay &&
        !/^- \[ \] Release evidence: `release-gate` remains uncertified for .+\.$/m.test(task.block)
      ) {
        throw new Error(`${task.id} must keep release-gate as a separate open row`)
      }
    } else {
      release.push(task.id)
      if (!task.block.includes("- [ ] Completion: acceptance and verification passed")) {
        throw new Error(`${task.id} release completion must remain open`)
      }
    }
    if (releaseOnly !== stage6ReleaseOnlyTaskIds.has(task.id)) {
      throw new Error(`${task.id} has the wrong core/release-only classification`)
    }
    if (hasCore) {
      for (const dependency of task.block.matchAll(/^- Blocked by(?: for T2-core)?: (.+)$/gm)) {
        const releaseDependency = /S6-F10(?:-T\d+)?|S6-F11-T2/.exec(dependency[1])?.[0]
        if (releaseDependency) {
          throw new Error(`${task.id} T2-core scope depends on release-only ${releaseDependency}`)
        }
      }
    }
  }

  if (tasks.length !== expectedCoreCount + expectedReleaseCount) {
    throw new Error(
      `Stage 6 task count changed: expected ${expectedCoreCount + expectedReleaseCount}, found ${tasks.length}`,
    )
  }
  if (core.length !== expectedCoreCount || release.length !== expectedReleaseCount) {
    throw new Error(
      `Stage 6 task classes changed: core=${core.length}/${expectedCoreCount}; release=${release.length}/${expectedReleaseCount}`,
    )
  }
  if (pureCore.length !== expectedPureCoreCount || mixedCore.length !== expectedMixedCoreCount) {
    throw new Error(
      `Stage 6 core task split changed: pure=${pureCore.length}/${expectedPureCoreCount}; mixed=${mixedCore.length}/${expectedMixedCoreCount}`,
    )
  }
  return {
    taskCount: tasks.length,
    coreCount: core.length,
    pureCoreCount: pureCore.length,
    mixedCoreCount: mixedCore.length,
    releaseCount: release.length,
    ids,
  }
}

function section(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Tier 2 ledger is missing the ${startMarker} bounded section`)
  }
  return content.slice(start, end)
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

function list(values) {
  return values.length ? values.join(",") : "none"
}

function main() {
  try {
    const result = validateStage6Tier2Ledger({
      matrix: readFileSync(resolve(root, "docs/stage6-full-feature-test-matrix.md"), "utf8"),
      ledger: readFileSync(resolve(root, "docs/stage6-tier2-candidate-ledger.md"), "utf8"),
    })
    const taskResult = validateStage6TaskBoards({
      taskBoards: stage6TaskBoardPaths.map((path) => ({
        path,
        content: readFileSync(resolve(root, path), "utf8"),
      })),
    })
    console.log(
      `Stage 6 Tier 2 ledger coverage passed (${result.ledgerCount}/${result.matrixCount} core rows; ${taskResult.pureCoreCount} pure core tasks; ${taskResult.mixedCoreCount} split core tasks; ${taskResult.releaseCount} open release tasks).`,
    )
  } catch (error) {
    console.error(
      `Stage 6 Tier 2 ledger check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
