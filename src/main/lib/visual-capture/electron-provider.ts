import { randomUUID } from "node:crypto"
import { desktopCapturer, screen, systemPreferences } from "electron"
import type { VisualCaptureProvider, VisualCaptureSource } from "./session"

const MAX_SOURCE_COUNT = 50
const MAX_CACHED_BYTES = 64 * 1_048_576

export class VisualCaptureCapabilityError extends Error {
  constructor(
    message: string,
    readonly recovery: string,
  ) {
    super(`${message} ${recovery}`)
    this.name = "VisualCaptureCapabilityError"
  }
}

/**
 * Electron's desktopCapturer supplies the exact frame shown in the source
 * chooser. Each returned id is a one-use opaque token, never an OS source id.
 */
export class ElectronVisualCaptureProvider implements VisualCaptureProvider {
  readonly #frames = new Map<string, { bytes: Buffer; sourceId: string; scaleFactor: number }>()
  readonly #maxCachedBytes: number
  #cachedBytes = 0

  constructor(options: { maxCachedBytes?: number } = {}) {
    this.#maxCachedBytes = options.maxCachedBytes ?? MAX_CACHED_BYTES
  }

  async enumerate(): Promise<VisualCaptureSource[]> {
    if (
      process.platform === "darwin" &&
      systemPreferences.getMediaAccessStatus("screen") === "denied"
    ) {
      throw new VisualCaptureCapabilityError(
        "Screen recording permission is denied.",
        "Open System Settings > Privacy & Security > Screen Recording, enable Flapstack, then retry.",
      )
    }
    let sources
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 1_920, height: 1_080 },
        fetchWindowIcons: false,
      })
    } catch (error) {
      throw new VisualCaptureCapabilityError(
        error instanceof Error ? error.message : "Visual capture is unavailable.",
        platformRecovery(),
      )
    }

    const displays = new Map(
      screen.getAllDisplays().map((display) => [String(display.id), display.scaleFactor]),
    )
    const result: VisualCaptureSource[] = []
    let cachedBytes = 0
    for (const source of sources.slice(0, MAX_SOURCE_COUNT)) {
      if (source.thumbnail.isEmpty()) continue
      const bytes = source.thumbnail.toPNG()
      if (bytes.byteLength === 0 || cachedBytes + bytes.byteLength > this.#maxCachedBytes) break
      const token = randomUUID()
      const displayId = source.display_id || null
      const scaleFactor = displayId ? (displays.get(displayId) ?? 1) : 1
      this.#frames.set(token, { bytes, sourceId: token, scaleFactor })
      this.#cachedBytes += bytes.byteLength
      cachedBytes += bytes.byteLength
      result.push({
        id: token,
        kind: source.id.startsWith("screen:") ? "screen" : "application-window",
        label: source.name.trim() || (displayId ? `Display ${displayId}` : "Application window"),
        displayId,
        previewDataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      })
    }
    this.#trimCache()
    if (result.length === 0) {
      throw new VisualCaptureCapabilityError(
        "No capturable screen or window source was returned.",
        platformRecovery(),
      )
    }
    return result
  }

  async capture(sourceId: string) {
    const frame = this.#frames.get(sourceId)
    this.#frames.delete(sourceId)
    if (frame) this.#cachedBytes -= frame.bytes.byteLength
    if (!frame) {
      throw new VisualCaptureCapabilityError(
        "The selected capture frame expired; no stale frame was reused.",
        "Open the visible source chooser and select the source again.",
      )
    }
    return frame
  }

  discard(sourceIds: string[]): void {
    for (const sourceId of sourceIds) {
      const frame = this.#frames.get(sourceId)
      if (frame) this.#cachedBytes -= frame.bytes.byteLength
      this.#frames.delete(sourceId)
    }
  }

  #trimCache(): void {
    while (this.#frames.size > MAX_SOURCE_COUNT || this.#cachedBytes > this.#maxCachedBytes) {
      const oldest = this.#frames.keys().next().value as string | undefined
      if (!oldest) return
      const frame = this.#frames.get(oldest)
      if (frame) this.#cachedBytes -= frame.bytes.byteLength
      this.#frames.delete(oldest)
    }
  }
}

function platformRecovery(): string {
  if (process.platform === "win32") {
    return "Verify the source is not protected content, then retry the visible source chooser."
  }
  if (process.platform === "linux") {
    return "Verify the active X11/Wayland portal permits screen sharing, then retry."
  }
  return "Grant Screen Recording permission in System Settings, verify the source is not protected content, then restart Flapstack and retry."
}
