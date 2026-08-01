import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  getMobileCompanionAsset,
  mobileCompanionAssetPaths,
} from "../src/main/lib/mobile-bridge/pwa"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("mobile companion user surfaces", () => {
  it("exposes a reachable Settings surface for bridge, QR pairing, and device lifecycle", () => {
    const atoms = source("src/renderer/lib/atoms/index.ts")
    const settings = source("src/renderer/features/settings/settings-content.tsx")
    const registry = source("src/renderer/features/settings/settings-visibility.ts")
    const mobile = source(
      "src/renderer/components/dialogs/settings-tabs/agents-mobile-companion-tab.tsx",
    )

    expect(atoms).toContain('"mobile-companion"')
    expect(settings).toContain("AgentsMobileCompanionTab")
    expect(registry).toContain('id: "mobile-companion"')
    expect(registry).toContain("Pairing, paired devices")
    expect(mobile).toContain("trpc.mobileBridge.createPairingOffer")
    expect(mobile).toContain("trpc.mobileBridge.listDevices")
    expect(mobile).toContain("trpc.mobileBridge.renameDevice")
    expect(mobile).toContain("trpc.mobileBridge.revokeDevice")
    expect(mobile).toContain("QRCode")
    expect(mobile).toContain("certificateFingerprint")
    expect(mobile).toContain("expiresAt")
  })

  it("serves an installable offline-safe PWA shell with honest notification language", () => {
    expect(mobileCompanionAssetPaths).toEqual(
      expect.arrayContaining([
        "/",
        "/mobile-app.js",
        "/manifest.webmanifest",
        "/service-worker.js",
      ]),
    )
    const document = getMobileCompanionAsset("/")
    const app = getMobileCompanionAsset("/mobile-app.js")
    const manifest = getMobileCompanionAsset("/manifest.webmanifest")
    const worker = getMobileCompanionAsset("/service-worker.js")

    expect(document).toMatchObject({
      status: 200,
      contentType: expect.stringContaining("text/html"),
    })
    expect(document?.body).toContain("Flapstack Companion")
    expect(document?.body).toContain("Offline · read-only")
    expect(app?.body).toContain("new WebSocket")
    expect(app?.body).toContain('"kind":"command"')
    expect(app?.body).toContain("Notifications are best effort")
    expect(document?.body).toContain('id="step-up-token"')
    expect(document?.body).toContain('role="status"')
    expect(app?.body).toContain("renderClarification")
    expect(app?.body).toContain("question.options")
    expect(app?.body).toContain("question.allowCustom")
    expect(app?.body).toContain('actionButton("Steer"')
    expect(app?.body).toContain('actionButton("Pause"')
    expect(app?.body).toContain('actionButton("Resume"')
    expect(app?.body).toContain('actionButton("Cancel"')
    expect(app?.body).toContain('actionButton("Approve"')
    expect(app?.body).toContain('actionButton("Deny"')
    expect(app?.body).toContain("confirm(")
    expect(app?.body).toContain("stepUpToken")
    expect(app?.body).toContain("deviceConfirmedAt")
    expect(app?.body).toContain("State is stale")
    expect(app?.body).toContain("serviceWorker.register")
    expect(manifest?.body).toContain('"display":"standalone"')
    expect(worker?.body).toContain("mobile-companion-v1")
  })
})
