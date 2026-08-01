import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("swarm group control router contract", () => {
  it("exposes exact-selection preview and execute routes through the reviewed authority", () => {
    const router = readFileSync("src/main/lib/trpc/routers/spawned-agents.ts", "utf8")
    const service = readFileSync(
      "src/main/lib/agent-orchestration/swarm-group-control-service.ts",
      "utf8",
    )

    expect(router).toContain("previewSwarmControl")
    expect(router).toContain("executeSwarmControl")
    expect(router).toContain("expectedPreview")
    expect(service).toContain("new SwarmGroupControl")
    expect(service).toContain(".execute(preview, this.#loadTargets(taskId))")
    expect(service).toContain("stale-selection")
  })
})
