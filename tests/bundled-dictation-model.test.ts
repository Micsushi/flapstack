import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { verifySpeechModel } from "../scripts/prepare-speech-model.mjs"

const state = vi.hoisted(() => ({ userData: "", packaged: true }))
vi.mock("electron", () => ({
  app: {
    getPath: () => state.userData,
    get isPackaged() {
      return state.packaged
    },
  },
}))
vi.mock("../src/main/lib/speech/settings", () => ({ getVoiceSettings: () => ({}) }))
vi.mock("../src/shared/parakeet-model.json", () => ({
  default: {
    file: "test.gguf",
    sizeBytes: 5,
    sha256: "9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4",
  },
}))

const roots: string[] = []
const originalResources = process.resourcesPath
afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(process, "resourcesPath", { value: originalResources, configurable: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("bundled dictation model", () => {
  it("validates exact contents and rejects damaged models", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "flapstack-model-test-"))
    roots.push(root)
    const file = path.join(root, "model")
    const expected = { sizeBytes: 5, sha256: createHash("sha256").update("model").digest("hex") }
    expect(await verifySpeechModel(file, expected)).toBe(false)
    writeFileSync(file, "model")
    expect(await verifySpeechModel(file, expected)).toBe(true)
    writeFileSync(file, "wrong")
    expect(await verifySpeechModel(file, expected)).toBe(false)
  })

  it("uses the installed model offline with a fresh user profile", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "flapstack-bundled-test-"))
    roots.push(root)
    state.userData = path.join(root, "profile")
    const resources = path.join(root, "resources")
    mkdirSync(path.join(resources, "speech-models"), { recursive: true })
    const bundled = path.join(resources, "speech-models", "test.gguf")
    writeFileSync(bundled, "model")
    Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true })
    const fetch = vi.fn(() => {
      throw new Error("offline")
    })
    vi.stubGlobal("fetch", fetch)
    const { ensureParakeetModel, getParakeetModelStatus } =
      await import("../src/main/lib/speech/stt-parakeet-streaming")
    expect(await getParakeetModelStatus()).toEqual({ status: "present", sizeBytes: 5 })
    expect(await ensureParakeetModel()).toBe(bundled)
    expect(fetch).not.toHaveBeenCalled()
  })
})
