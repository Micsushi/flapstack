export type AnalyticsConsentWindow = {
  isDestroyed: () => boolean
  webContents: {
    isDestroyed: () => boolean
    send: (channel: string, consentGranted: boolean) => void
  }
}

/** Notify every live renderer so revocation takes effect across all windows. */
export function broadcastAnalyticsConsent(
  windows: readonly AnalyticsConsentWindow[],
  consentGranted: boolean,
): void {
  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    try {
      window.webContents.send("analytics:consent-changed", consentGranted)
    } catch {
      // A renderer may disappear between the liveness check and send. Consent
      // persistence remains authoritative, and other live windows must update.
    }
  }
}
