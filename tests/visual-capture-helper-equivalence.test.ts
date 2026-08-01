import { describe, expect, it } from "vitest"
import {
  visualCaptureEntrypointContract,
  visualCaptureSafetyBoundaryId,
} from "../src/main/lib/visual-capture/helper-contract"

describe("standalone visual capture helper equivalence contract", () => {
  it("cannot own capture, storage, consent, redaction, or scope outside the in-app boundary", () => {
    const inApp = visualCaptureEntrypointContract("in-app")
    const helper = visualCaptureEntrypointContract("standalone-helper")
    expect(helper.safetyBoundaryId).toBe(visualCaptureSafetyBoundaryId)
    expect(helper.sharedSafetyRules).toEqual(inApp.sharedSafetyRules)
    expect(helper).toMatchObject({
      canCaptureWithoutFlapstack: false,
      ownsDatabase: false,
      ownsArtifactStorage: false,
      opensVisibleUserFlow: true,
    })
  })
})
