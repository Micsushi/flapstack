import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  createVisualCaptureDerivative,
  visualCaptureEditSchema,
} from "../src/main/lib/visual-capture/derivative"

async function fixture() {
  return sharp({
    create: {
      width: 20,
      height: 12,
      channels: 4,
      background: { r: 250, g: 10, b: 30, alpha: 1 },
    },
  })
    .withMetadata({ density: 144 })
    .png()
    .toBuffer()
}

describe("visual capture derivative", () => {
  it("crops, irreversibly redacts, strips metadata, and returns the exact preview hash", async () => {
    const original = await fixture()
    const result = await createVisualCaptureDerivative(original, {
      crop: { left: 2, top: 1, width: 12, height: 8 },
      redactions: [{ left: 1, top: 2, width: 4, height: 3, color: "#000000" }],
      annotations: [],
    })
    const image = sharp(result.bytes)
    const metadata = await image.metadata()
    const pixel = await image.extract({ left: 1, top: 2, width: 4, height: 3 }).raw().toBuffer()

    expect(metadata).toMatchObject({ format: "png", width: 12, height: 8 })
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(new Set(pixel)).toEqual(new Set([0, 255]))
    expect(result.derivativeSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.previewSha256).toBe(result.derivativeSha256)
    expect(result.originalSha256).not.toBe(result.derivativeSha256)
    expect(result.redactionState).toBe("redacted")
  })

  it("rasterizes bounded box, arrow, and text annotations into the derivative", async () => {
    const result = await createVisualCaptureDerivative(await fixture(), {
      crop: null,
      redactions: [],
      annotations: [
        { kind: "box", left: 1, top: 1, width: 8, height: 6, color: "#00ff00" },
        { kind: "arrow", fromX: 2, fromY: 10, toX: 15, toY: 2, color: "#0000ff" },
        { kind: "text", left: 3, top: 3, text: "Review", color: "#ffffff" },
      ],
    })

    expect(result.width).toBe(20)
    expect(result.height).toBe(12)
    expect(result.annotationCount).toBe(3)
    expect(result.bytes.equals(await fixture())).toBe(false)
  })

  it("rejects out-of-bounds edits, empty redactions, hostile SVG text, and oversized images", async () => {
    const original = await fixture()
    await expect(
      createVisualCaptureDerivative(original, {
        crop: null,
        redactions: [{ left: 19, top: 0, width: 2, height: 2, color: "#000000" }],
        annotations: [],
      }),
    ).rejects.toThrow(/bounds/)

    expect(
      visualCaptureEditSchema.safeParse({
        crop: null,
        redactions: [],
        annotations: [
          {
            kind: "text",
            left: 0,
            top: 0,
            text: "<script>alert(1)</script>",
            color: "#ffffff",
          },
        ],
      }).success,
    ).toBe(false)

    const hugeHeader = await sharp({
      create: {
        width: 5000,
        height: 4000,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer()
    await expect(
      createVisualCaptureDerivative(hugeHeader, {
        crop: null,
        redactions: [],
        annotations: [],
      }),
    ).rejects.toThrow(/pixel limit/)
  })
})
