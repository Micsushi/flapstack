import { describe, expect, it } from "vitest"

import {
  getLocalDictationReadiness,
  LOCAL_DICTATION_PRIVACY_NOTE,
} from "../src/renderer/lib/local-dictation-readiness"

const availability = (overrides: {
  available?: boolean
  canAutoProvision?: boolean
  reason?: string
  missingDependency?: "engine" | "audio-converter" | "model"
}) => ({
  available: overrides.available ?? false,
  method: overrides.available ? "local-whisper" : null,
  adapters: [
    {
      adapterId: "local-whisper",
      available: overrides.available ?? false,
      canAutoProvision: overrides.canAutoProvision ?? false,
      reason: overrides.reason,
      missingDependency: overrides.missingDependency,
    },
  ],
})

describe("local dictation readiness", () => {
  it("keeps first-use state actionable while readiness is loading", () => {
    expect(getLocalDictationReadiness()).toMatchObject({
      kind: "checking",
      ready: false,
      action: "wait",
    })
  })

  it("routes to Voice settings when the local engine is missing", () => {
    const readiness = getLocalDictationReadiness(
      availability({ reason: "whisper.cpp binary not found", missingDependency: "engine" }),
      { status: "absent" },
    )
    expect(readiness).toMatchObject({
      kind: "needs-engine",
      ready: false,
      action: "open-settings",
    })
    expect(readiness.description).toContain("whisper-cli")
  })

  it("routes missing local audio conversion to Voice settings", () => {
    const readiness = getLocalDictationReadiness(
      availability({
        canAutoProvision: false,
        missingDependency: "audio-converter",
        reason: "ffmpeg is required",
      }),
      { status: "present", sizeBytes: 150_000_000 },
    )
    expect(readiness).toMatchObject({
      kind: "needs-engine",
      title: "Local dictation needs ffmpeg",
      action: "open-settings",
    })
  })

  it("offers a local model download when whisper.cpp is available", () => {
    expect(
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "absent",
      }),
    ).toMatchObject({ kind: "needs-model", ready: false, action: "download" })
  })

  it("reports live model progress and retry state", () => {
    expect(
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "downloading",
        percent: 42,
      }),
    ).toMatchObject({ kind: "downloading", percent: 42, action: "wait" })
    expect(
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "error",
        message: "connection lost",
      }),
    ).toMatchObject({ kind: "error", action: "retry" })
  })

  it("becomes ready only with a local engine and model", () => {
    expect(
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "present",
        sizeBytes: 150_000_000,
      }),
    ).toMatchObject({ kind: "ready", ready: true, action: "record" })
    expect(
      getLocalDictationReadiness(availability({ available: true, canAutoProvision: true }), {
        status: "present",
        sizeBytes: 150_000_000,
      }),
    ).toMatchObject({ kind: "ready", ready: true })
  })

  it("states the local-only privacy boundary in every state", () => {
    const states = [
      getLocalDictationReadiness(),
      getLocalDictationReadiness(availability({}), { status: "absent" }),
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "absent",
      }),
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "downloading",
        percent: 5,
      }),
      getLocalDictationReadiness(availability({ canAutoProvision: true }), {
        status: "error",
        message: "offline",
      }),
    ]
    for (const state of states) {
      expect(state.description).toContain(LOCAL_DICTATION_PRIVACY_NOTE)
    }
  })
})
