import { describe, expect, it } from "vitest"
import { presentRunError } from "../src/renderer/features/agents/main/run-error-presentation"

describe("run error presentation", () => {
  it("identifies Windows launch permission failures without calling them usage limits", () => {
    expect(presentRunError("Codex App Server probe failed: spawn EPERM", "win32")).toEqual({
      title: "Codex couldn’t start",
      message:
        "Windows blocked Flapstack from starting the Codex App Server. This is a local launch or permissions problem, not a usage-limit error.",
      technicalDetail: "Codex App Server probe failed: spawn EPERM",
    })
  })

  it("identifies Linux launch permission failures without calling them usage limits", () => {
    expect(
      presentRunError("Codex App Server probe failed: spawn /opt/flapstack/codex EACCES", "linux"),
    ).toEqual({
      title: "Codex couldn’t start",
      message:
        "Linux blocked Flapstack from starting the Codex App Server. Check executable permissions and mount options, then retry.",
      technicalDetail: "Codex App Server probe failed: spawn /opt/flapstack/codex EACCES",
    })
  })

  it("labels actual provider usage and rate-limit errors", () => {
    expect(presentRunError("429 insufficient_quota: rate limit exceeded")).toMatchObject({
      title: "Usage limit reached",
      message: expect.stringContaining("usage"),
    })
  })

  it("does not relabel a provider permission denial as a local launch failure", () => {
    expect(presentRunError("Provider permission denied", "linux")).toEqual({
      title: "Run failed",
      message: "Provider permission denied",
      technicalDetail: null,
    })
  })

  it("keeps an unknown provider error visible", () => {
    expect(presentRunError("Provider connection closed")).toEqual({
      title: "Run failed",
      message: "Provider connection closed",
      technicalDetail: null,
    })
  })
})
