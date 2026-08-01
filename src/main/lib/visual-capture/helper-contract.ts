export const visualCaptureSafetyBoundaryId = "flapstack.visual-capture.v1" as const

const sharedSafetyRules = Object.freeze({
  visibleUserInitiationOrExactApproval: true,
  userSelectsExactSource: true,
  exactEditedPreviewBeforeConfirm: true,
  metadataStrippedDerivativeOnly: true,
  immutableContextHash: true,
  cancellationAndExpiryPurgeRawFrame: true,
  projectScopeRequired: true,
  continuousCapture: false,
  webcamCapture: false,
})

export function visualCaptureEntrypointContract(entrypoint: "in-app" | "standalone-helper") {
  return {
    entrypoint,
    safetyBoundaryId: visualCaptureSafetyBoundaryId,
    sharedSafetyRules,
    opensVisibleUserFlow: true,
    canCaptureWithoutFlapstack: false,
    ownsDatabase: false,
    ownsArtifactStorage: false,
  } as const
}
