import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  name: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
}

describe("repository readiness", () => {
  it("keeps package metadata on the Flapstack app identity", () => {
    expect(packageJson.name).toBe("flapstack")
    expect(packageJson.dependencies.shiki).toMatch(/^\^4\./)
  })

  it("keeps hosted release automation out of package scripts", () => {
    const scripts = Object.keys(packageJson.scripts)

    expect(scripts).not.toContain("release")
    expect(scripts).not.toContain("release:dev")
    expect(scripts).not.toContain("dist:upload")
    expect(scripts).not.toContain("dist:manifest")
    expect(scripts).not.toContain("sync:public")
  })

  it("defines local commit gates", () => {
    expect(packageJson.scripts.lint).toBeTruthy()
    expect(packageJson.scripts["style:check"]).toBeTruthy()
    expect(packageJson.scripts.test).toBeTruthy()
    expect(packageJson.scripts.build).toBeTruthy()
    expect(packageJson.scripts.check).toContain("scripts/check.mjs")
    const checkScript = readFileSync("scripts/check.mjs", "utf8")
    expect(checkScript).toContain('packageBinStep("lint", "eslint"')
    expect(checkScript).toContain('packageBinStep("style", "prettier"')
    expect(checkScript).toContain('packageBinStep("typecheck", "typescript"')
    expect(checkScript).toContain('packageBinStep("tests", "vitest"')
    expect(checkScript).toContain('path.join(root, "scripts", "build.mjs")')
  })
})
