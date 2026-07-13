// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
})

const { AgentModelTuningSelector } =
  await import("../src/renderer/features/agents/components/agent-model-selector")

const claudeModels = [
  {
    id: "claude-opus",
    name: "Opus",
    version: "4.8",
    efforts: ["low", "medium", "high"] as const,
  },
]

const codexModels = [
  {
    id: "gpt-fast",
    name: "GPT Fast",
    reasoningLevels: ["low", "medium", "high"] as const,
    supportsFastMode: true,
  },
  {
    id: "gpt-standard",
    name: "GPT Standard",
    reasoningLevels: ["low", "high"] as const,
    supportsFastMode: false,
  },
]

let root: Root | null = null

function renderTuning(overrides: Record<string, unknown> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  const props = {
    selectedAgentId: "codex" as const,
    reasoningEnabled: true,
    onReasoningEnabledChange: vi.fn(),
    claude: {
      models: claudeModels,
      selectedModelId: "claude-opus",
      hasCustomModelConfig: false,
      isOffline: false,
      selectedEffort: "high" as const,
      onSelectEffort: vi.fn(),
    },
    codex: {
      models: codexModels,
      selectedModelId: "gpt-fast",
      selectedReasoning: "high" as const,
      onSelectReasoning: vi.fn(),
      fastModeEnabled: false,
      onFastModeChange: vi.fn(),
    },
    ...overrides,
  }

  act(() => root!.render(React.createElement(AgentModelTuningSelector, props)))
  return { container, props }
}

async function openTuning(container: HTMLElement) {
  const trigger = container.querySelector("button")
  expect(trigger).not.toBeNull()
  await act(async () => trigger!.click())
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("AgentModelTuningSelector", () => {
  it("shows the selected reasoning and enabled fast state without opening", () => {
    const { container } = renderTuning({
      codex: {
        models: codexModels,
        selectedModelId: "gpt-fast",
        selectedReasoning: "medium",
        onSelectReasoning: vi.fn(),
        fastModeEnabled: true,
        onFastModeChange: vi.fn(),
      },
    })

    expect(container.textContent).toContain("Medium")
    expect(container.textContent).toContain("Fast")
  })

  it("changes reasoning independently", async () => {
    const { container, props } = renderTuning()
    await openTuning(container)
    const medium = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Medium",
    )
    expect(medium).not.toBeUndefined()
    await act(async () => medium!.click())
    expect(props.codex.onSelectReasoning).toHaveBeenCalledWith("medium")
  })

  it("shows fast mode only for a supported selected model", async () => {
    const supported = renderTuning()
    await openTuning(supported.container)
    expect(document.body.textContent).toContain("Fast mode")

    act(() => root?.unmount())
    document.body.innerHTML = ""
    root = null

    const unsupported = renderTuning({
      codex: {
        models: codexModels,
        selectedModelId: "gpt-standard",
        selectedReasoning: "high",
        onSelectReasoning: vi.fn(),
        fastModeEnabled: true,
        onFastModeChange: vi.fn(),
      },
    })
    await openTuning(unsupported.container)
    expect(document.body.textContent).not.toContain("Fast mode")
    expect(unsupported.container.textContent).not.toContain("Fast")
  })

  it("shows the reasoning toggle for providers without a separate effort setting", async () => {
    const { container, props } = renderTuning({ selectedAgentId: "openrouter" })
    expect(container.textContent).toContain("Reasoning")
    await openTuning(container)
    const toggle = document.body.querySelector('[aria-label="Show reasoning"]') as HTMLElement
    expect(toggle).not.toBeNull()
    await act(async () => toggle.click())
    expect(props.onReasoningEnabledChange).toHaveBeenCalledWith(false)
  })
})
