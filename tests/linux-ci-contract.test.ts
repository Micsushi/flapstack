import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const requireFromTest = createRequire(import.meta.url)
const { load: parseYaml } = requireFromTest("js-yaml") as {
  load(source: string): Record<string, unknown>
}

describe("Linux CI contract", () => {
  it("runs the native Linux check, package, smoke, audit, and upload gates", () => {
    const workflow = parseYaml(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<
        string,
        {
          if?: string
          "runs-on": string[]
          steps: Array<{
            name?: string
            env?: Record<string, string>
            run?: string
            uses?: string
            with?: Record<string, unknown>
          }>
        }
      >
    }
    const job = workflow.jobs.verify
    expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'")
    expect(job["runs-on"]).toEqual(["self-hosted", "Linux", "X64", "flapstack"])
    const steps = Object.fromEntries(job.steps.map((step) => [step.name, step]))
    expect(steps["Setup Node"].with?.["node-version"]).toBe(22)
    expect(steps["Setup Python"].with?.["python-version"]).toBe("3.12")
    expect(steps["Setup Rust"].with?.toolchain).toBe("1.98.0")
    expect(steps["Install Linux package prerequisites"].run).toBe(
      "python -m pip install --disable-pip-version-check cmake==4.4.3",
    )
    expect(steps["Install dependencies"].run).toBe("npm ci --legacy-peer-deps")
    expect(steps.Check.run).toBe("npm run check -- --portable-linux")
    expect(steps["Build Linux Preview artifacts"].run).toBe(
      "npm run package:preview:linux:artifacts",
    )
    expect(steps["Build Linux Preview artifacts"].env?.GITHUB_TOKEN).toBe("${{ github.token }}")
    expect(steps["Inspect Linux Preview"].run).toBe("npm run package:inspect:preview:linux")
    expect(steps["Smoke Linux Preview"].run).toBe("npm run package:smoke:preview:linux")
    expect(steps["Audit Linux Preview"].run).toBe("npm run package:audit:preview:linux")
    expect(steps["Audit production dependencies"].run).toBe(
      "npm audit --omit=dev --audit-level=high",
    )
    expect(steps["Rehash Linux Preview audit"].run).toContain("sha256sum")
    expect(steps["Upload Linux Preview"].with?.path).toContain(
      "release-preview/linux-security-report-x64.json",
    )
    expect(steps["Upload Linux Preview"].with?.["retention-days"]).toBe(3)
  })
})
