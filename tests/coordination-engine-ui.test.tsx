import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CoordinationEngineLaunchPreview } from "../src/shared/coordination-engine"
import {
  CoordinationEngineAvailability,
  CoordinationEngineLaunchPreviewPanel,
} from "../src/renderer/features/agents/ui/coordination-engine-launch-preview"

const blockedReason = {
  code: "engine-capability-missing" as const,
  engine: "codex-v2" as const,
  message: "Codex V2 task-tree capability has not been registered.",
  missingCapabilities: ["named-task-paths" as const],
  repair: "Enable a compatible Codex Runtime.",
}

const preview: CoordinationEngineLaunchPreview = {
  ok: true,
  source: "product",
  requestedEngine: "workflow",
  resolved: {
    schemaVersion: 1,
    requestedEngine: "workflow",
    source: "product",
    engine: "workflow",
    engineVersion: "workflow-v1",
    capabilities: {
      schemaVersion: 1,
      engine: "workflow",
      engineVersion: "workflow-v1",
      status: "available",
      capturedAt: "2026-07-14T00:00:00.000Z",
      capabilities: ["durable-workflow", "checkpoints", "mixed-runtimes"],
      limitations: [],
      unavailableReason: null,
    },
    providerIdentity: null,
  },
  blockedReason: null,
  options: [
    {
      engine: "workflow",
      label: "Workflow",
      description: "Deterministic workflow",
      advanced: false,
      selected: true,
      supported: true,
      reason: null,
    },
    {
      engine: "codex-v2",
      label: "Codex task tree (V2)",
      description: "Native named task tree",
      advanced: false,
      selected: false,
      supported: false,
      reason: blockedReason,
    },
    {
      engine: "codex-v1",
      label: "Codex legacy threads (V1)",
      description: "Advanced legacy mode",
      advanced: true,
      selected: false,
      supported: false,
      reason: { ...blockedReason, engine: "codex-v1", message: "V1 adapter unavailable." },
    },
  ],
}

describe("coordination engine settings and launch preview", () => {
  it("keeps unavailable choices visible with exact reasons", () => {
    const html = renderToStaticMarkup(<CoordinationEngineAvailability options={preview.options} />)
    expect(html).toContain('aria-label="Coordination engine availability"')
    expect(html).toContain("Codex task tree (V2)")
    expect(html).toContain("Unavailable")
    expect(html).toContain(blockedReason.message)
    expect(html).toContain(blockedReason.repair)
    expect(html).toContain('role="status"')
  })

  it("renders an accessible immutable launch preview and disables unsupported options", () => {
    const html = renderToStaticMarkup(
      <CoordinationEngineLaunchPreviewPanel
        preview={preview}
        selection={null}
        onSelectionChange={vi.fn()}
      />,
    )
    expect(html).toContain("Launch override")
    expect(html).toContain('id="coordination-engine-launch-select"')
    expect(html).toContain('aria-describedby="coordination-engine-launch-status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("Version workflow-v1 will be frozen before work starts")
    expect(html).toMatch(/value="codex-v2" disabled=""/)
    expect(html).toContain(blockedReason.message)
  })

  it("announces blocking preview reason without fallback", () => {
    const blocked: CoordinationEngineLaunchPreview = {
      ...preview,
      ok: false,
      requestedEngine: "codex-v2",
      source: "per-launch",
      resolved: null,
      blockedReason,
      options: preview.options.map((option) => ({
        ...option,
        selected: option.engine === "codex-v2",
      })),
    }
    const html = renderToStaticMarkup(
      <CoordinationEngineLaunchPreviewPanel
        preview={blocked}
        selection="codex-v2"
        onSelectionChange={vi.fn()}
      />,
    )
    expect(html).toContain(blockedReason.message)
    expect(html).toContain(blockedReason.repair)
    expect(html).not.toContain("Resolved Workflow")
  })
})
