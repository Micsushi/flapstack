import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  bytes: Buffer.from("selected-png"),
  getSources: vi.fn(),
  mediaStatus: "granted",
}))

vi.mock("electron", () => ({
  desktopCapturer: {
    getSources: state.getSources,
  },
  screen: {
    getAllDisplays: () => [{ id: 1, scaleFactor: 1.5 }],
  },
  systemPreferences: {
    getMediaAccessStatus: () => state.mediaStatus,
  },
}))

import {
  ElectronVisualCaptureProvider,
  VisualCaptureCapabilityError,
} from "../src/main/lib/visual-capture/electron-provider"

beforeEach(() => {
  state.getSources.mockReset()
  state.getSources.mockResolvedValue([
    {
      id: "screen:1:0",
      name: "Display 1",
      display_id: "1",
      thumbnail: {
        isEmpty: () => false,
        toPNG: () => state.bytes,
      },
    },
  ])
})

describe("Electron visual capture provider", () => {
  it("returns an opaque one-use id bound to the exact visible preview frame", async () => {
    const provider = new ElectronVisualCaptureProvider()
    const sources = await provider.enumerate()
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: "screen",
      label: "Display 1",
      displayId: "1",
      previewDataUrl: `data:image/png;base64,${state.bytes.toString("base64")}`,
    })
    expect(sources[0]?.id).not.toContain("screen:1")
    expect(state.getSources).toHaveBeenCalledWith({
      types: ["screen", "window"],
      thumbnailSize: { width: 1_920, height: 1_080 },
      fetchWindowIcons: false,
    })

    await expect(provider.capture(sources[0]!.id)).resolves.toEqual({
      bytes: state.bytes,
      sourceId: sources[0]!.id,
      scaleFactor: 1.5,
    })
    await expect(provider.capture(sources[0]!.id)).rejects.toBeInstanceOf(
      VisualCaptureCapabilityError,
    )
  })

  it("fails visibly when protected content yields no frame", async () => {
    state.getSources.mockResolvedValue([
      {
        id: "window:4:0",
        name: "Protected",
        display_id: "",
        thumbnail: { isEmpty: () => true, toPNG: vi.fn() },
      },
    ])
    const provider = new ElectronVisualCaptureProvider()
    await expect(provider.enumerate()).rejects.toMatchObject({
      name: "VisualCaptureCapabilityError",
      message: expect.stringMatching(/protected|verify|retry/i),
      recovery: expect.stringMatching(/retry|verify/i),
    })
  })

  it("classifies Electron window sources as application windows without exposing native ids", async () => {
    state.getSources.mockResolvedValue([
      {
        id: "window:4:0",
        name: "Editor",
        display_id: "",
        thumbnail: {
          isEmpty: () => false,
          toPNG: () => state.bytes,
        },
      },
    ])
    const provider = new ElectronVisualCaptureProvider()
    const [source] = await provider.enumerate()
    expect(source).toMatchObject({
      kind: "application-window",
      label: "Editor",
      displayId: null,
    })
    expect(source?.id).not.toContain("window:4")
  })

  it("evicts old one-use frames when repeated enumeration reaches the global byte budget", async () => {
    const largeFrame = Buffer.alloc(8, 1)
    state.getSources.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `screen:${index}:0`,
        name: `Display ${index}`,
        display_id: "1",
        thumbnail: {
          isEmpty: () => false,
          toPNG: () => largeFrame,
        },
      })),
    )
    const provider = new ElectronVisualCaptureProvider({ maxCachedBytes: 32 })
    const first = await provider.enumerate()
    await provider.enumerate()
    await expect(provider.capture(first[0]!.id)).rejects.toMatchObject({
      name: "VisualCaptureCapabilityError",
    })
  })
})
