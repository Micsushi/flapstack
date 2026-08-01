import { describe, expect, it } from "vitest"
import {
  clearProjectVaultGraphSelection,
  readProjectVaultGraphSelection,
  stageProjectVaultGraphSelection,
} from "../src/renderer/features/project-vault/pending-graph-context"

describe("pending project vault graph context", () => {
  it("stages an isolated single-use project selection and clears it after launch", () => {
    const selection = {
      nodeIds: ["custom:one"],
      expectedGenerationId: "generation-1",
      expansion: { depth: 1, direction: "outgoing" as const, maxNodes: 4 },
    }
    stageProjectVaultGraphSelection("project-1", selection)
    selection.nodeIds.push("mutated")

    const firstRead = readProjectVaultGraphSelection("project-1")
    expect(firstRead).toEqual({
      nodeIds: ["custom:one"],
      expectedGenerationId: "generation-1",
      expansion: { depth: 1, direction: "outgoing", maxNodes: 4 },
    })
    firstRead!.nodeIds.push("also-mutated")
    expect(readProjectVaultGraphSelection("project-1")?.nodeIds).toEqual(["custom:one"])
    expect(readProjectVaultGraphSelection("project-2")).toBeUndefined()

    clearProjectVaultGraphSelection("project-1")
    expect(readProjectVaultGraphSelection("project-1")).toBeUndefined()
  })
})
