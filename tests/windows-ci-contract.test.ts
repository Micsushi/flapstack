import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const requireFromTest = createRequire(import.meta.url)
const { load: parseYaml } = requireFromTest("js-yaml") as {
  load(source: string): Record<string, unknown>
}

describe("Windows CI contract", () => {
  it("runs the native Windows install, check, package, and inspection gates", () => {
    const workflow = parseYaml(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<
        string,
        {
          "runs-on": string
          env?: Record<string, string>
          steps: Array<{
            name?: string
            run?: string
            uses?: string
            with?: Record<string, unknown>
          }>
        }
      >
    }
    const job = workflow.jobs["windows-verify"]
    expect(job["runs-on"]).toBe("windows-2022")
    expect(job.env?.FLAPSTACK_REQUIRE_FILE_SYMLINK_TESTS).toBe("1")
    const steps = Object.fromEntries(job.steps.map((step) => [step.name, step]))
    expect(steps["Setup Node"].with?.["node-version"]).toBe(22)
    expect(steps["Setup Python"].with?.["python-version"]).toBe("3.11")
    expect(steps["Install dependencies"].run).toBe("npm ci --legacy-peer-deps")
    expect(steps["Verify Windows prerequisites"].run).toBe("npm run windows:prerequisites")
    expect(steps["Configure Stage 6 performance profile"].run).toContain(
      "powercfg /SETACTIVE SCHEME_BALANCED",
    )
    expect(steps["Configure Stage 6 performance profile"].run).toContain(
      "powercfg /GETACTIVESCHEME",
    )
    expect(steps.Check.run).toBe("npm run check")
    expect(steps["Build Windows Preview"].run).toBe("npm run package:preview:win")
    expect(steps["Inspect Windows Preview"].run).toBe("npm run package:inspect:preview:win")
    expect(steps["Audit Windows Preview"].run).toBe("npm run package:audit:preview:win")
    expect(steps["Upload Windows Preview"].with?.path).toContain(
      "release-preview/windows-security-report.json",
    )
  })
})
