import { describe, expect, it } from "vitest"
import {
  flapshotStatusLabel,
  flapshotActionErrorMessage,
  flapshotCaptureControlsEnabled,
  operationStatusLabel,
} from "../src/renderer/features/agents/ui/flapshot-ui"

describe("Flapshot capture UI status", () => {
  it("shows correlated lifecycle failure instead of success", () => {
    expect(
      operationStatusLabel({
        kind: "screenshot",
        state: "interrupted",
        progressMessage: null,
        errorMessage: "Flapshot MCP disconnected",
      }),
    ).toBe("screenshot: Flapshot MCP disconnected")
  })

  it("prefers current progress while an operation runs", () => {
    expect(
      operationStatusLabel({
        kind: "recording",
        state: "running",
        progressMessage: "Recording media",
        errorMessage: null,
      }),
    ).toBe("recording: Recording media")
  })

  it("shows the exact live pairing code before enabling actions", () => {
    expect(
      flapshotStatusLabel({
        connected: true,
        paired: false,
        pairingCode: "042913",
        serverVersion: "0.1.0",
        error: null,
      }),
    ).toBe("Pair code 042913 in Flapshot Agent access")
  })

  it("keeps same-session approval retry guidance explicit", () => {
    expect(flapshotActionErrorMessage("POLICY_DENIED: APPROVAL_REQUIRED", "Capture failed")).toBe(
      "Approve this request in Flapshot, then retry without reconnecting",
    )
  })

  it("keeps transport-owned pairing state explicit without claiming authority", () => {
    expect(
      flapshotStatusLabel({
        connected: true,
        paired: null,
        pairingCode: null,
        serverVersion: "0.1.0",
        error: null,
      }),
    ).toBe("Flapshot 0.1.0 · pair pending MCP access in Flapshot if prompted")
    expect(flapshotCaptureControlsEnabled(true, null)).toBe(false)
    expect(flapshotCaptureControlsEnabled(true, false)).toBe(false)
    expect(flapshotCaptureControlsEnabled(true, true)).toBe(true)
  })
})
