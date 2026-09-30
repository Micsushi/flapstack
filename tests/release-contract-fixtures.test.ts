import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

const fixtureRoot = "tests/fixtures/verification-contracts"

it("preserves revision-pinned, sanitized verification inputs", () => {
  const manifest = JSON.parse(readFileSync(`${fixtureRoot}/provenance.json`, "utf8"))
  expect(manifest.sourceCommit).toMatch(/^[a-f0-9]{40}$/)
  expect(manifest.files).toHaveLength(78)
  for (const file of manifest.files) {
    const text = readFileSync(`${fixtureRoot}/${file.fixturePath}`, "utf8").replace(/\r\n/g, "\n")
    expect(createHash("sha256").update(text).digest("hex")).toBe(file.fixtureSha256Lf)
    expect(file.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(text).not.toMatch(/\/Users\/michaelshi|C:[\\/]Users[\\/]sushi/)
  }
})

it("runs every ledger check without live plans, human docs or a private Records service", () => {
  const root = mkdtempSync(join(tmpdir(), "flapstack-verification-contracts-"))
  try {
    mkdirSync(join(root, "scripts"))
    cpSync(fixtureRoot, join(root, fixtureRoot), { recursive: true })
    expect(existsSync(join(root, "openspec"))).toBe(false)
    expect(existsSync(join(root, "docs"))).toBe(false)
    for (const script of [
      "check-stage3-release-ledger.mjs",
      "check-stage6-tier2-ledger.mjs",
      "check-usage-exit-matrix.mjs",
    ]) {
      cpSync(join("scripts", script), join(root, "scripts", script))
      expect(
        execFileSync(process.execPath, [join(root, "scripts", script)], {
          cwd: root,
          encoding: "utf8",
          timeout: 10_000,
        }),
      ).toContain("coverage passed")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("keeps the development OpenSpec validator and status on complete retained changes", () => {
  for (const change of ["add-stage1-workspace-core", "add-dev-test-control-mcp"]) {
    for (const file of ["proposal.md", "design.md", "tasks.md", "specs"]) {
      expect(existsSync(`${fixtureRoot}/openspec/changes/${change}/${file}`)).toBe(true)
    }
  }
  const service = readFileSync("src/main/lib/mcp-test-control/service.ts", "utf8")
  const validator = service
    .split("export async function openspecValidate(")[1]
    .split("export async function getHarnessStatusForRepo")[0]
  expect(validator).toContain('join(repoPath, "tests", "fixtures", "verification-contracts")')
  expect(validator).toContain("cwd: fixturePath")
  expect(validator).toContain('"add-stage1-workspace-core"')
  expect(validator).toContain('"--strict"')
})
