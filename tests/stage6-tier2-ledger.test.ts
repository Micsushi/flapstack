import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  stage6TaskBoardPaths,
  validateStage6TaskBoards,
  validateStage6Tier2Ledger,
} from "../scripts/check-stage6-tier2-ledger.mjs"

describe("Stage 6 Tier 2 candidate ledger", () => {
  it("maps every one of the 60 authoritative T2-core rows exactly once", () => {
    const result = validateStage6Tier2Ledger({
      matrix: readFileSync("docs/stage6-full-feature-test-matrix.md", "utf8"),
      ledger: readFileSync("docs/stage6-tier2-candidate-ledger.md", "utf8"),
      expectedCount: 60,
    })

    expect(result).toMatchObject({ matrixCount: 60, ledgerCount: 60 })
  })

  it("rejects missing, extra, and duplicate mappings", () => {
    const matrix = "- [ ] **[T2-core] S6-A01** first\n- [ ] **[T2-core] S6-A02** second\n"
    const ledger = [
      "## Core row map",
      "| Core ID | Evidence | Status |",
      "| --- | --- | --- |",
      "| S6-A01 | suite | pending |",
      "| S6-A01 | duplicate | pending |",
      "| S6-X99 | extra | pending |",
      "## Open nonblocking overlays",
    ].join("\n")

    expect(() => validateStage6Tier2Ledger({ matrix, ledger, expectedCount: 2 })).toThrow(
      /duplicates=S6-A01.*missing=S6-A02.*extra=S6-X99/,
    )
  })

  it("keeps Stage 6 core task completion separate from open release certification", () => {
    const result = validateStage6TaskBoards({
      taskBoards: stage6TaskBoardPaths.map((path) => ({
        path,
        content: readFileSync(path, "utf8"),
      })),
    })

    expect(result).toMatchObject({
      taskCount: 100,
      coreCount: 91,
      pureCoreCount: 50,
      mixedCoreCount: 41,
      releaseCount: 9,
    })
  })

  it("rejects checked capability evidence", () => {
    const taskBoards = [
      {
        path: "core.md",
        content: [
          "### S6-F1-T1 - core",
          "",
          "- Evidence classes: `T2-core`, `T2-capability:device`.",
          "- [x] T2-core completion: acceptance and verification passed",
          "- [x] Capability evidence: `T2-capability:device` remains uncertified.",
        ].join("\n"),
      },
    ]

    expect(() =>
      validateStage6TaskBoards({ taskBoards, expectedCoreCount: 1, expectedReleaseCount: 0 }),
    ).toThrow(/incorrectly checked non-core evidence row/)
  })

  it("rejects a closed release-only task", () => {
    const taskBoards = [
      {
        path: "release.md",
        content: [
          "### S6-F10-T1 - release",
          "",
          "- Evidence class: `release-gate`.",
          "- [x] Completion: acceptance and verification passed",
        ].join("\n"),
      },
    ]

    expect(() =>
      validateStage6TaskBoards({ taskBoards, expectedCoreCount: 0, expectedReleaseCount: 1 }),
    ).toThrow(/release completion must remain open/)
  })

  it("rejects a declared overlay without a matching open evidence row", () => {
    const taskBoards = [
      {
        path: "core.md",
        content: [
          "### S6-F1-T1 - core",
          "",
          "- Evidence classes: `T2-core`, `T2-capability:device`.",
          "- [x] T2-core completion: acceptance and verification passed",
        ].join("\n"),
      },
    ]

    expect(() =>
      validateStage6TaskBoards({
        taskBoards,
        expectedCoreCount: 1,
        expectedReleaseCount: 0,
        expectedPureCoreCount: 0,
        expectedMixedCoreCount: 1,
      }),
    ).toThrow(/separate open row/)
  })

  it("rejects a prose dependency from core to Stage 6 distribution", () => {
    const taskBoards = [
      {
        path: "core.md",
        content: [
          "### S6-F1-T1 - core",
          "",
          "- Evidence class: `T2-core`.",
          "- [x] T2-core completion: acceptance and verification passed",
          "- Blocked by: native package rows from S6-F10",
        ].join("\n"),
      },
    ]

    expect(() =>
      validateStage6TaskBoards({
        taskBoards,
        expectedCoreCount: 1,
        expectedReleaseCount: 0,
        expectedPureCoreCount: 1,
        expectedMixedCoreCount: 0,
      }),
    ).toThrow(/depends on release-only S6-F10/)
  })
})
