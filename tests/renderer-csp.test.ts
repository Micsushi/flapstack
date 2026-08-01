import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const rendererHtml = readFileSync(join(process.cwd(), "src", "renderer", "index.html"), "utf8")
const debugTab = readFileSync(
  join(
    process.cwd(),
    "src",
    "renderer",
    "components",
    "dialogs",
    "settings-tabs",
    "agents-debug-tab.tsx",
  ),
  "utf8",
)

describe("renderer production content security policy", () => {
  it("does not allow evaluated, inline, or remote scripts", () => {
    const csp = rendererHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
    expect(csp).toBeDefined()

    const scriptDirective = csp
      ?.split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("script-src "))

    expect(scriptDirective).toBe("script-src 'self'")
    expect(rendererHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })

  it("never downloads executable debug tooling into the renderer", () => {
    expect(debugTab).not.toContain("unpkg.com")
    expect(debugTab).not.toContain('document.createElement("script")')
    expect(debugTab).not.toContain("React Scan")
  })

  it("does not allow renderer network access to hosted telemetry", () => {
    const csp = rendererHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
    const connectDirective = csp
      ?.split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("connect-src "))

    expect(connectDirective).toBe("connect-src 'self' ws://localhost:* http://localhost:*")
    expect(connectDirective).not.toContain("posthog")
  })
})
