import { describe, expect, it } from "vitest"
import {
  probeCursorCapabilities,
  probeOpencodeCapabilities,
} from "../src/main/lib/harness/provider-capabilities"

describe("provider capability probes", () => {
  it("records current Cursor version and filters model headers", async () => {
    const snapshot = await probeCursorCapabilities(async (args) => {
      const command = args.join(" ")
      if (command === "--version") return result("2026.07.09-a3815c0")
      if (command === "--help") return result("Commands: models status mcp login")
      if (command === "status") return result("Logged in as test@example.com")
      if (command === "models") {
        return result("Models:\nAvailable models\nauto - Auto\ncomposer-2.5 - Composer 2.5")
      }
      throw new Error(`Unexpected command: ${command}`)
    })

    expect(snapshot.version).toBe("2026.07.09-a3815c0")
    expect(snapshot.modelIds).toEqual(["auto", "composer-2.5"])
    expect(snapshot.modelIds).not.toContain("Models:")
    expect(snapshot.probes.status.ok).toBe(true)
  })

  it("retains typed probe failure instead of treating it as capability", async () => {
    const snapshot = await probeCursorCapabilities(async (args) => {
      if (args[0] === "models") throw new Error("cursor-agent models timed out after 15000ms")
      return result(args[0] === "--version" ? "2026.07.09-a3815c0" : "help")
    })

    expect(snapshot.modelIds).toEqual([])
    expect(snapshot.probes.models).toMatchObject({
      ok: false,
      exitCode: null,
      error: expect.stringContaining("timed out"),
    })
    expect(snapshot.limitations).toContain("No executable Cursor model IDs were discovered.")
  })

  it("records OpenCode CLI truth separately from provider catalogs", async () => {
    const snapshot = await probeOpencodeCapabilities(async (args) => {
      return result(args[0] === "--version" ? "1.17.18" : "opencode [command]")
    })

    expect(snapshot.version).toBe("1.17.18")
    expect(snapshot.modelIds).toEqual([])
    expect(snapshot.limitations).toContain(
      "OpenRouter and NanoGPT model IDs come from authenticated provider catalogs, not CLI help.",
    )
  })
})

function result(stdout: string) {
  return { stdout, stderr: "", exitCode: 0 }
}
