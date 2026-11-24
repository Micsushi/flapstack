import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { planProviderTransition, type ProviderSelection } from "../src/shared/provider-transition"
import { ProviderProbeCache, providerProbeKey } from "../src/main/lib/agent-runtime/probe-cache"
import { linkPastedText } from "../src/main/lib/attachments/pasted-reference"

afterEach(() => vi.restoreAllMocks())

describe("provider selection transitions", () => {
  const current: ProviderSelection = {
    harness: "codex",
    runtime: "codex",
    model: "gpt",
    reasoningEffort: "low",
  }
  it("applies a model or effort on the next Codex turn", () => {
    for (const target of [
      { ...current, model: "gpt-other" },
      { ...current, reasoningEffort: "high" },
    ])
      expect(planProviderTransition({ current, target, hasHistory: true })).toEqual({
        type: "apply_on_next_turn",
      })
  })

  it("reopens a Claude process for new controls while preserving its native history", () => {
    const claude = { ...current, harness: "claude-code", runtime: "claude-code" }
    expect(
      planProviderTransition({
        current: claude,
        target: { ...claude, model: "claude-new" },
        hasHistory: true,
      }),
    ).toEqual({ type: "restart_session" })
  })

  it("requires a handoff only when switching a started chat and rejects active provider switches", () => {
    const target = {
      ...current,
      harness: "antigravity",
      runtime: "flapstack-native",
      model: "gemini",
    }
    expect(planProviderTransition({ current, target, hasHistory: false }).type).toBe(
      "apply_on_next_turn",
    )
    expect(planProviderTransition({ current, target, hasHistory: true }).type).toBe(
      "create_with_handoff",
    )
    expect(planProviderTransition({ current, target, hasHistory: true, active: true }).type).toBe(
      "reject",
    )
    expect(
      planProviderTransition({
        current,
        target: { ...current, model: "another" },
        hasHistory: true,
        supportsModelSwitch: false,
      }).type,
    ).toBe("reject")
  })
})

it("keeps a good catalog through failures within the same provider home only", async () => {
  const cache = new ProviderProbeCache<string[]>(1000)
  const binary = join(tmpdir(), "provider")
  const key = providerProbeKey(binary, { HOME: join(tmpdir(), "account-one") })
  const other = providerProbeKey(binary, { HOME: join(tmpdir(), "account-two") })
  const probe = vi.fn(async () => ["model-one"])
  await expect(Promise.all([cache.get(key, probe), cache.get(key, probe)])).resolves.toEqual([
    ["model-one"],
    ["model-one"],
  ])
  expect(probe).toHaveBeenCalledOnce()
  cache.invalidate(key)
  const fail = async () => {
    throw new Error("Provider offline")
  }
  await expect(cache.get(key, fail)).resolves.toEqual(["model-one"])
  await expect(cache.get(other, fail)).rejects.toThrow("Provider offline")
  await expect(cache.get(key, async () => ["model-two"])).resolves.toEqual(["model-two"])
})

it("passes an owned paste by path without reading it or disclosing another chat's reference", async () => {
  const root = mkdtempSync(join(tmpdir(), "flapstack-provider-paste-"))
  try {
    const own = join(root, "claude-sessions", "current", "pasted", "pasted_123.txt")
    const other = join(root, "claude-sessions", "other", "pasted", "pasted_456.txt")
    for (const file of [own, other]) {
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileSync(file, "sentinel".repeat(20_000))
    }
    const format = (path: string) => "@[pasted:160000:preview|" + path + "]"
    const history = "@[chatHistory:160000:history|" + own + "]"
    const prompt = await linkPastedText([format(own), format(other), history].join(" "), root, [
      "current",
    ])
    expect(prompt).toContain("Pasted text file.")
    expect(prompt).toContain("pasted_123.txt")
    expect(prompt).toContain("Pasted attachment unavailable")
    expect(prompt).not.toContain("pasted_456.txt")
    expect(prompt).not.toContain("sentinel")
    expect(prompt).toContain(history)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
