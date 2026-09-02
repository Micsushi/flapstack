import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { APP_COMMAND_CHANNEL, APP_COMMANDS, parseAppCommand } from "../src/shared/app-command"

const requireFromTest = createRequire(import.meta.url)
const { load: parseYaml } = requireFromTest("js-yaml") as {
  load(source: string): Record<string, unknown>
}

describe("macOS app command contract", () => {
  it("accepts only the commands exposed to the renderer", () => {
    expect(APP_COMMAND_CHANNEL).toBe("app:command")
    expect(APP_COMMANDS.map(parseAppCommand)).toEqual(APP_COMMANDS)
    expect(parseAppCommand("open-devtools")).toBeNull()
    expect(parseAppCommand({ command: "navigate-back" })).toBeNull()
  })

  it("keeps app history and navigation in the native macOS menu", () => {
    const mainSource = readFileSync("src/main/index.ts", "utf8")
    expect(mainSource).toContain('accelerator: "Cmd+Z"')
    expect(mainSource).toContain('click: () => sendAppCommand("history-undo")')
    expect(mainSource).toContain('click: () => sendAppCommand("history-redo")')
    expect(mainSource).toContain('label: "Go"')
    expect(mainSource).toContain('accelerator: "Cmd+["')
    expect(mainSource).toContain('click: () => sendAppCommand("navigate-forward")')
  })

  it("keeps macOS renderer frames active when AppKit reports the page hidden", () => {
    const windowSource = readFileSync("src/main/windows/main.ts", "utf8")

    expect(windowSource).toContain(
      'process.platform === "darwin" || launchPresentation.keepRendererActive',
    )
    expect(windowSource).toContain("backgroundThrottling: false")
  })
})

describe("macOS CI contract", () => {
  it("pins every macOS release action to an immutable commit", () => {
    const workflow = readFileSync(".github/workflows/release-macos.yml", "utf8")
    const actionLines = workflow.split("\n").filter((line) => line.includes("uses: actions/"))

    expect(actionLines.length).toBeGreaterThan(0)
    expect(
      actionLines.every((line) => /uses: actions\/[^@]+@[0-9a-f]{40}(?:\s|$)/.test(line)),
    ).toBe(true)
  })

  it("bounds local test concurrency and timeouts for macOS", () => {
    const config = readFileSync("vitest.config.ts", "utf8")

    expect(config).toContain('["win32", "darwin"].includes(process.platform)')
    expect(config).toContain("boundedHost ? 4 : undefined")
    expect(config).toContain("boundedHost ? 20_000 : 5_000")
  })

  it("defines a native package gate that stays disabled until explicitly enabled", () => {
    const workflow = parseYaml(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<
        string,
        {
          if?: string
          "runs-on": string
          steps: Array<{
            name?: string
            env?: Record<string, string>
            run?: string
            with?: Record<string, unknown>
          }>
        }
      >
    }
    const job = workflow.jobs["macos-verify"]
    expect(job.if).toBe("vars.FLAPSTACK_MACOS_CI_ENABLED == 'true'")
    expect(job["runs-on"]).toBe("macos-15")
    const steps = Object.fromEntries(job.steps.map((step) => [step.name, step]))
    expect(steps["Setup Node"].with?.["node-version"]).toBe(22)
    expect(steps["Install dependencies"].run).toBe("npm ci --legacy-peer-deps")
    expect(steps.Build.run).toBe("npm run build")
    expect(steps["Build macOS Preview"].run).toBe("npm run package:preview:mac")
    expect(steps["Inspect macOS Preview"].run).toBe("npm run package:smoke:preview:mac")
    expect(steps["Build macOS Preview"].env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false")
  })
})
