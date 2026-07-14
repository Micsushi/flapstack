import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const changesRoot = resolve(root, "openspec/changes")
const ledger = readFileSync(resolve(root, "docs/stage3-release-candidate-ledger.md"), "utf8")

const activeChanges = readdirSync(changesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "archive")
  .map((entry) => entry.name)
  .sort()

const changeMappings = parseMappings("stage3-release-change", "change")
assertSameSet("active OpenSpec changes", [...changeMappings.keys()], activeChanges)

const evidenceCorpus = collectMarkdown(resolve(root, "docs"), {
  exclude: new Set([resolve(root, "docs/stage3-release-candidate-ledger.md")]),
}).concat(collectMarkdown(resolve(root, "tests/fixtures")))
const releaseRows = [...new Set([...changeMappings.values()].flatMap((mapping) => mapping.rows))]
for (const row of releaseRows) {
  if (!containsRowDefinition(evidenceCorpus, row))
    fail(`release row ${row} has no evidence-board definition`)
}

let scenarioCount = 0
for (const change of activeChanges) {
  const mapping = changeMappings.get(change)
  if (!mapping?.rows.length) fail(`change ${change} has no release rows`)
  const specsRoot = resolve(changesRoot, change, "specs")
  scenarioCount += countScenarios(specsRoot)
}

const featureMappings = parseMappings("stage3-release-feature", "feature")
const expectedFeatures = Array.from({ length: 17 }, (_, index) => `S3-F${index + 1}`)
assertSameSet("Stage 3 feature exits", [...featureMappings.keys()], expectedFeatures)
const taskCorpus = collectMarkdown(changesRoot, { basename: "tasks.md" })

for (const [feature, mapping] of featureMappings) {
  if (!mapping.exit) fail(`${feature} has no exit task`)
  if (!containsTaskHeading(taskCorpus, mapping.exit))
    fail(`${feature} exit task ${mapping.exit} does not exist`)
  for (const dependency of mapping.depends) {
    if (!featureMappings.has(dependency)) fail(`${feature} has unknown dependency ${dependency}`)
  }
}

const requiredReleaseDependencies = [
  "S3-F6",
  "S3-F9",
  "S3-F10",
  "S3-F12",
  "S3-F13",
  "S3-F14",
  "S3-F15",
  "S3-F16",
]
const releaseDependencies = featureMappings.get("S3-F17").depends
for (const dependency of requiredReleaseDependencies) {
  if (!releaseDependencies.includes(dependency)) {
    fail(`S3-F17 is missing required dependency ${dependency}`)
  }
}

const visiting = new Set()
const visited = new Set()
for (const feature of featureMappings.keys()) visit(feature)

for (const field of [
  "Candidate source:",
  "Checkout:",
  "Profile isolation:",
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT RUN",
  "Cleanup",
]) {
  if (!ledger.includes(field)) fail(`missing ledger field: ${field}`)
}

console.log(
  `stage3 release ledger coverage passed (${activeChanges.length} changes, ${scenarioCount} scenarios, ${releaseRows.length} release rows, ${featureMappings.size} feature exits)`,
)

function collectMarkdown(directory, options = {}) {
  let content = ""
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (options.exclude?.has(path)) continue
    if (entry.isDirectory()) content += collectMarkdown(path, options)
    if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      (!options.basename || entry.name === options.basename)
    ) {
      content += `\n${readFileSync(path, "utf8")}`
    }
  }
  return content
}

function containsRowDefinition(content, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^(?:- \\[[ xX]\\] \\*\\*${escaped}(?:[ (]|\\*\\*)|\\| \\s*${escaped}\\s*\\|)`,
    "m",
  ).test(content)
}

function containsTaskHeading(content, taskId) {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^### ${escaped}(?: —| -|$)`, "m").test(content)
}

function parseMappings(kind, keyName) {
  const mappings = new Map()
  const pattern = new RegExp(`<!-- ${kind}: ([^|]+)\\|([^>]+)-->`, "g")
  for (const match of ledger.matchAll(pattern)) {
    const key = match[1].trim()
    if (mappings.has(key)) fail(`duplicate ${kind} mapping for ${key}`)
    const fields = Object.fromEntries(
      match[2]
        .split("|")
        .map((field) => field.trim())
        .filter(Boolean)
        .map((field) => {
          const separator = field.indexOf("=")
          if (separator < 0) fail(`malformed ${kind} field: ${field}`)
          return [field.slice(0, separator), field.slice(separator + 1)]
        }),
    )
    mappings.set(key, {
      [keyName]: key,
      rows: splitList(fields.rows),
      exit: fields.exit,
      depends: splitList(fields.depends),
    })
  }
  return mappings
}

function splitList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function countScenarios(directory) {
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) count += countScenarios(path)
    if (entry.isFile() && entry.name === "spec.md") {
      count += [...readFileSync(path, "utf8").matchAll(/^#### Scenario:/gm)].length
    }
  }
  return count
}

function visit(feature) {
  if (visited.has(feature)) return
  if (visiting.has(feature)) fail(`feature dependency cycle includes ${feature}`)
  visiting.add(feature)
  for (const dependency of featureMappings.get(feature).depends) visit(dependency)
  visiting.delete(feature)
  visited.add(feature)
}

function assertSameSet(label, actual, expected) {
  const duplicates = actual.filter((value, index) => actual.indexOf(value) !== index)
  const missing = expected.filter((value) => !actual.includes(value))
  const extra = actual.filter((value) => !expected.includes(value))
  if (duplicates.length || missing.length || extra.length) {
    fail(
      `${label} mismatch; duplicates=${duplicates.join(",") || "none"}; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`,
    )
  }
}

function fail(message) {
  console.error(`stage3 release ledger check failed: ${message}`)
  process.exit(1)
}
