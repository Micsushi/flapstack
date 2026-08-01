import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  FeatureVisibilityConflictError,
  FeatureVisibilityStore,
} from "../src/main/lib/feature-visibility/store"
import {
  FEATURE_VISIBILITY_REGISTRY,
  previewVisibilityPreset,
} from "../src/shared/feature-visibility"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Stage 6 feature visibility persistence", () => {
  it("durably classifies first use once so concurrent windows cannot disagree", () => {
    const path = join(createDirectory(), "feature-visibility.json")
    const freshWindow = new FeatureVisibilityStore({ path, profileKind: "fresh" })
    const existingWindow = new FeatureVisibilityStore({ path, profileKind: "existing" })

    expect(freshWindow.initialize().status).toBe("pending-onboarding")
    expect(existingWindow.initialize().status).toBe("pending-onboarding")
    expect(new FeatureVisibilityStore({ path, profileKind: "existing" }).read().status).toBe(
      "pending-onboarding",
    )
  })

  it("preserves every optional surface for an existing user until explicit apply", () => {
    const store = createStore("existing")
    const initial = store.read()
    expect(initial.status).toBe("upgrade-preserved")
    expect(Object.values(initial.visibility).every(Boolean)).toBe(true)
    expect(initial.revision).toBe(0)

    const preview = previewVisibilityPreset(initial.visibility, "focused", {
      existingUser: true,
      preserveUnknown: true,
    })
    expect(store.read()).toEqual(initial)

    const applied = store.apply({
      expectedRevision: initial.revision,
      preset: "focused",
      visibility: preview.result,
    })
    expect(applied.status).toBe("configured")
    expect(applied.revision).toBe(1)
    expect(applied.visibility).toEqual(preview.result)
  })

  it("keeps a fresh profile pending and skip applies Standard only after confirmation", () => {
    const store = createStore("fresh")
    const initial = store.read()
    expect(initial.status).toBe("pending-onboarding")
    expect(Object.values(initial.visibility).every(Boolean)).toBe(true)

    const preview = previewVisibilityPreset(initial.visibility, "standard")
    const applied = store.apply({
      expectedRevision: 0,
      preset: "standard",
      visibility: preview.result,
    })
    expect(applied.preset).toBe("standard")
    expect(applied.status).toBe("configured")
  })

  it("can initialize an isolated fresh performance profile with an explicit preset", () => {
    const path = join(createDirectory(), "feature-visibility.json")
    const store = new FeatureVisibilityStore({
      path,
      profileKind: "fresh",
      freshProfilePreset: "standard",
    })

    const initialized = store.initialize()

    expect(initialized).toMatchObject({
      revision: 0,
      status: "configured",
      preset: "standard",
    })
    expect(initialized.visibility).toEqual(
      previewVisibilityPreset(
        Object.fromEntries(FEATURE_VISIBILITY_REGISTRY.map((entry) => [entry.id, true])),
        "standard",
      ).result,
    )
    expect(new FeatureVisibilityStore({ path, profileKind: "fresh" }).read()).toEqual(initialized)
  })

  it("uses revision compare-and-set so two windows cannot silently overwrite", () => {
    const store = createStore("existing")
    const first = store.initialize()
    store.apply({
      expectedRevision: first.revision,
      preset: "complete",
      visibility: previewVisibilityPreset(first.visibility, "complete").result,
    })
    expect(() =>
      store.apply({
        expectedRevision: first.revision,
        preset: "focused",
        visibility: previewVisibilityPreset(first.visibility, "focused").result,
      }),
    ).toThrow(FeatureVisibilityConflictError)
  })

  it("fails visibly and safely on corrupt preferences without hiding features", () => {
    const directory = createDirectory()
    const path = join(directory, "feature-visibility.json")
    writeFileSync(path, '{"version":1,"visibility":', "utf8")
    const store = new FeatureVisibilityStore({ path, profileKind: "existing" })
    const recovered = store.read()

    expect(recovered.status).toBe("repair-required")
    expect(Object.values(recovered.visibility).every(Boolean)).toBe(true)
    expect(readFileSync(path, "utf8")).toBe('{"version":1,"visibility":')
    expect(() => store.initialize()).toThrow(/repair/i)
  })

  it("defaults unknown future features visible and rejects always-visible or unknown writes", () => {
    const store = createStore("existing")
    const initial = store.read()
    expect(store.isVisible("future-feature")).toBe(true)
    expect(() =>
      store.apply({
        expectedRevision: initial.revision,
        preset: "standard",
        visibility: { ...initial.visibility, settings: false },
      }),
    ).toThrow(/unknown or always-visible/i)
    expect(Object.keys(initial.visibility)).toEqual(
      FEATURE_VISIBILITY_REGISTRY.map((entry) => entry.id),
    )
  })
})

function createStore(profileKind: "fresh" | "existing") {
  const store = new FeatureVisibilityStore({
    path: join(createDirectory(), "feature-visibility.json"),
    profileKind,
  })
  store.initialize()
  return store
}

function createDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-feature-visibility-"))
  directories.push(directory)
  return directory
}
