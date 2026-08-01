import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createFeatureVisibilityRouter } from "../src/main/lib/trpc/routers/feature-visibility"
import { previewVisibilityPreset } from "../src/shared/feature-visibility"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Stage 6 feature visibility router", () => {
  it("persists first-use classification and broadcasts confirmed changes", async () => {
    const path = preferencePath()
    const broadcast = vi.fn()
    const first = createFeatureVisibilityRouter({ path, broadcast }).createCaller({
      getWindow: () => null,
    })
    const second = createFeatureVisibilityRouter({ path }).createCaller({
      getWindow: () => null,
    })

    const initial = await first.get({ profileKind: "fresh" })
    expect((await second.get({ profileKind: "existing" })).status).toBe("pending-onboarding")

    const preview = previewVisibilityPreset(initial.visibility, "focused", {
      preserveUnknown: true,
    })
    const applied = await first.applyChanges({
      profileKind: "fresh",
      expectedRevision: initial.revision,
      preset: preview.preset,
      visibility: preview.result,
    })

    expect(applied).toMatchObject({ revision: 1, status: "configured", preset: "focused" })
    expect(broadcast).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledWith(applied)
  })

  it("returns a conflict instead of letting a stale window overwrite", async () => {
    const caller = createFeatureVisibilityRouter({ path: preferencePath() }).createCaller({
      getWindow: () => null,
    })
    const initial = await caller.get({ profileKind: "existing" })
    const complete = previewVisibilityPreset(initial.visibility, "complete")
    await caller.applyChanges({
      profileKind: "existing",
      expectedRevision: initial.revision,
      preset: complete.preset,
      visibility: complete.result,
    })

    const focused = previewVisibilityPreset(initial.visibility, "focused")
    await expect(
      caller.applyChanges({
        profileKind: "existing",
        expectedRevision: initial.revision,
        preset: focused.preset,
        visibility: focused.result,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("configures only an explicitly preset fresh test profile", async () => {
    const caller = createFeatureVisibilityRouter({
      path: preferencePath(),
      freshProfilePreset: "standard",
    }).createCaller({
      getWindow: () => null,
    })

    await expect(caller.get({ profileKind: "fresh" })).resolves.toMatchObject({
      revision: 0,
      status: "configured",
      preset: "standard",
    })
  })
})

function preferencePath() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-feature-visibility-router-"))
  directories.push(directory)
  return join(directory, "feature-visibility.json")
}
