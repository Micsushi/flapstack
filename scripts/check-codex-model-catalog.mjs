#!/usr/bin/env node

import { existsSync } from "node:fs"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const DEFAULT_CACHE_PATH = path.join(process.env.HOME ?? "", ".codex", "models_cache.json")
const DEFAULT_IGNORED_MODELS = ["codex-auto-review"]

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function listFromEnv(value) {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
}

function sameList(left, right) {
  // Order-insensitive: providers may report reasoning levels in a different
  // order than the static catalog without that being real drift.
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

async function loadCatalogModule() {
  const sourcePath = path.resolve("src/shared/model-catalog.ts")
  const source = await readFile(sourcePath, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText

  const tempDir = await mkdtemp(path.join(tmpdir(), "flapstack-model-catalog-"))
  const tempFile = path.join(tempDir, "model-catalog.mjs")
  await writeFile(tempFile, output)

  try {
    return await import(pathToFileURL(tempFile).href)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function normalizeLiveModel(model) {
  return {
    id: model.slug,
    efforts: (model.supported_reasoning_levels ?? []).map((level) => level.effort),
    supportsFastMode: (model.additional_speed_tiers ?? []).includes("fast"),
    supportsApiKey: Boolean(model.supported_in_api),
  }
}

function normalizeStaticModel(model) {
  return {
    id: model.id,
    efforts: [...(model.thinkings ?? [])],
    supportsFastMode: Boolean(model.supportsFastMode),
    supportsApiKey: Boolean(model.authSurfaces?.includes("api-key")),
  }
}

async function main() {
  const modelsPath =
    readArg("--models") ?? process.env.CODEX_MODELS_CATALOG_JSON ?? DEFAULT_CACHE_PATH
  const requireCatalog =
    process.env.REQUIRE_CODEX_MODELS_CATALOG === "1" || process.argv.includes("--require-catalog")
  const ignoredModels = new Set([
    ...DEFAULT_IGNORED_MODELS,
    ...listFromEnv(process.env.CODEX_MODEL_DRIFT_IGNORE),
  ])

  if (!modelsPath || !existsSync(modelsPath)) {
    const message = `Codex model catalog JSON was not found at ${modelsPath || "(unset)"}.`
    if (requireCatalog) {
      console.error(message)
      console.error("Run `npx codex debug models > codex-models.json` and pass --models.")
      process.exit(1)
    }

    console.warn(`${message} Skipping provider catalog drift check.`)
    return
  }

  const liveCatalog = JSON.parse(await readFile(modelsPath, "utf8"))
  const liveModels = (liveCatalog.models ?? [])
    .filter((model) => model.visibility === "list")
    .filter((model) => !ignoredModels.has(model.slug))
    .map(normalizeLiveModel)

  const { CODEX_MODELS } = await loadCatalogModule()
  const staticModels = CODEX_MODELS.map(normalizeStaticModel)
  const liveById = new Map(liveModels.map((model) => [model.id, model]))
  const staticById = new Map(staticModels.map((model) => [model.id, model]))
  const failures = []

  for (const liveModel of liveModels) {
    const staticModel = staticById.get(liveModel.id)
    if (!staticModel) {
      failures.push(`Provider exposes ${liveModel.id}, but Flapstack does not list it.`)
      continue
    }

    if (!sameList(staticModel.efforts, liveModel.efforts)) {
      failures.push(
        `${liveModel.id} reasoning levels differ: Flapstack=${staticModel.efforts.join(",")} Provider=${liveModel.efforts.join(",")}`,
      )
    }

    if (staticModel.supportsFastMode !== liveModel.supportsFastMode) {
      failures.push(
        `${liveModel.id} fast mode differs: Flapstack=${staticModel.supportsFastMode} Provider=${liveModel.supportsFastMode}`,
      )
    }

    if (staticModel.supportsApiKey !== liveModel.supportsApiKey) {
      failures.push(
        `${liveModel.id} API-key availability differs: Flapstack=${staticModel.supportsApiKey} Provider=${liveModel.supportsApiKey}`,
      )
    }
  }

  for (const staticModel of staticModels) {
    if (!liveById.has(staticModel.id)) {
      failures.push(`Flapstack lists ${staticModel.id}, but the provider catalog does not.`)
    }
  }

  const summaryLines = [
    "## Codex model catalog drift",
    "",
    `Checked ${staticModels.length} Flapstack models against ${liveModels.length} provider models from \`${modelsPath}\`.`,
    "",
  ]

  if (failures.length > 0) {
    summaryLines.push("Failures:", "", ...failures.map((failure) => `- ${failure}`), "")
    const summary = summaryLines.join("\n")
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
    console.error(summary)
    process.exit(1)
  }

  summaryLines.push("No Codex model catalog drift detected.", "")
  const summary = summaryLines.join("\n")
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
