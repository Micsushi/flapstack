import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const matrixPath = resolve(root, "docs/stage3-usage-exit-matrix.md")
const specPath = resolve(root, "openspec/specs/usage-exit-hardening/spec.md")
const matrix = readFileSync(matrixPath, "utf8")
const spec = readFileSync(specPath, "utf8")

const expectedRows = [
  "U1-01",
  "U1-02",
  "U1-03",
  "U2-01",
  "U2-02",
  "U3-01",
  "U3-02",
  "U3-03",
  "U3-04",
  "U4-01",
  "U5-01",
  "U6-03",
  "U7-01",
  "U7-02",
  "U8-01",
  "U8-02",
  "U8-03",
  "U8-04",
  "U9-01",
  "U9-02",
  "U10-01",
  "U10-02",
  "U10-03",
  "U10-04",
  "U11-01",
  "U11-02",
  "U11-03",
  "U11-04",
  "U11-05",
]

const legacyRows = [...matrix.matchAll(/^\|\s+(U\d+-\d+)\s+\|/gm)].map((match) => match[1])
assertSameSet("migrated Usage rows", legacyRows, expectedRows)

const scenarios = [...spec.matchAll(/^#### Scenario: (.+)$/gm)].map((match) => match[1])
for (const scenario of scenarios) {
  const escaped = scenario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (!new RegExp(`^\\|\\s+SC-\\d+\\s+\\|\\s+${escaped}\\s+\\|`, "m").test(matrix)) {
    fail(`missing scenario coverage row: ${scenario}`)
  }
}

for (const field of [
  "Commit:",
  "OS and architecture:",
  "Executable and profile:",
  "Database:",
  "Provider and CLI versions:",
  "Sanitized artifacts:",
  "Cleanup:",
]) {
  if (!matrix.includes(field)) fail(`missing evidence field: ${field}`)
}

if (/^- \[[ xX]\]/m.test(matrix)) {
  fail("matrix must not become a second checkbox checklist")
}

console.log(
  `usage exit matrix coverage passed (${legacyRows.length} rows, ${scenarios.length} scenarios)`,
)

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
  console.error(`usage exit matrix check failed: ${message}`)
  process.exit(1)
}
