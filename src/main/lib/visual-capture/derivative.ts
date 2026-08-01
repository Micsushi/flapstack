import { createHash } from "node:crypto"
import sharp from "sharp"
import { z } from "zod"

const MAX_SOURCE_BYTES = 32 * 1_048_576
const MAX_SOURCE_PIXELS = 16_000_000
const coordinate = z.number().int().min(0).max(20_000)
const dimension = z.number().int().min(1).max(20_000)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const rectangle = z
  .object({
    left: coordinate,
    top: coordinate,
    width: dimension,
    height: dimension,
  })
  .strict()

export const visualCaptureEditSchema = z
  .object({
    crop: rectangle.nullable(),
    redactions: z.array(rectangle.extend({ color }).strict()).max(100),
    annotations: z
      .array(
        z.discriminatedUnion("kind", [
          rectangle.extend({ kind: z.literal("box"), color }).strict(),
          z
            .object({
              kind: z.literal("arrow"),
              fromX: coordinate,
              fromY: coordinate,
              toX: coordinate,
              toY: coordinate,
              color,
            })
            .strict(),
          z
            .object({
              kind: z.literal("text"),
              left: coordinate,
              top: coordinate,
              text: z
                .string()
                .trim()
                .min(1)
                .max(500)
                .refine((value) => !/[<>&\u0000-\u001f]/.test(value), {
                  message: "Annotation text contains unsupported markup or control characters.",
                }),
              color,
            })
            .strict(),
        ]),
      )
      .max(100),
  })
  .strict()

export type VisualCaptureEdit = z.infer<typeof visualCaptureEditSchema>

export async function createVisualCaptureDerivative(
  source: Buffer,
  editValue: unknown,
): Promise<{
  bytes: Buffer
  width: number
  height: number
  originalSha256: string
  derivativeSha256: string
  previewSha256: string
  redactionState: "none" | "redacted"
  redactionCount: number
  annotationCount: number
}> {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Visual capture source exceeds the 32 MiB encoded size limit.")
  }
  const edit = visualCaptureEditSchema.parse(editValue)
  const metadata = await sharp(source, { failOn: "error", limitInputPixels: MAX_SOURCE_PIXELS })
    .metadata()
    .catch((error) => {
      if (error instanceof Error && /pixel limit/i.test(error.message)) {
        throw new Error("Visual capture source exceeds the 16 megapixel limit.", {
          cause: error,
        })
      }
      throw new Error("Visual capture source is not a supported image.", { cause: error })
    })
  const sourceWidth = metadata.width ?? 0
  const sourceHeight = metadata.height ?? 0
  if (sourceWidth < 1 || sourceHeight < 1 || sourceWidth * sourceHeight > MAX_SOURCE_PIXELS) {
    throw new Error("Visual capture source exceeds the 16 megapixel limit.")
  }
  if (edit.crop) assertRectangleInside(edit.crop, sourceWidth, sourceHeight, "Crop")
  const width = edit.crop?.width ?? sourceWidth
  const height = edit.crop?.height ?? sourceHeight
  for (const redaction of edit.redactions) {
    assertRectangleInside(redaction, width, height, "Redaction")
  }
  for (const annotation of edit.annotations) {
    if (annotation.kind === "box") {
      assertRectangleInside(annotation, width, height, "Box annotation")
    } else if (annotation.kind === "arrow") {
      for (const [name, x, y] of [
        ["Arrow start", annotation.fromX, annotation.fromY],
        ["Arrow end", annotation.toX, annotation.toY],
      ] as const) {
        if (x >= width || y >= height) throw new Error(`${name} is outside image bounds.`)
      }
    } else if (annotation.left >= width || annotation.top >= height) {
      throw new Error("Text annotation is outside image bounds.")
    }
  }

  let pipeline = sharp(source, { failOn: "error", limitInputPixels: MAX_SOURCE_PIXELS })
  if (edit.crop) pipeline = pipeline.extract(edit.crop)
  const composites: Parameters<ReturnType<typeof sharp>["composite"]>[0] = edit.redactions.map(
    (redaction) => ({
      input: {
        create: {
          width: redaction.width,
          height: redaction.height,
          channels: 4,
          background: redaction.color,
        },
      },
      left: redaction.left,
      top: redaction.top,
    }),
  )
  if (edit.annotations.length) {
    composites.push({ input: Buffer.from(annotationSvg(width, height, edit.annotations)) })
  }
  if (composites.length) pipeline = pipeline.composite(composites)
  const bytes = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
  const derivativeSha256 = sha256(bytes)
  return {
    bytes,
    width,
    height,
    originalSha256: sha256(source),
    derivativeSha256,
    previewSha256: derivativeSha256,
    redactionState: edit.redactions.length ? "redacted" : "none",
    redactionCount: edit.redactions.length,
    annotationCount: edit.annotations.length,
  }
}

function annotationSvg(
  width: number,
  height: number,
  annotations: VisualCaptureEdit["annotations"],
): string {
  const content = annotations
    .map((annotation, index) => {
      if (annotation.kind === "box") {
        return `<rect x="${annotation.left}" y="${annotation.top}" width="${annotation.width}" height="${annotation.height}" fill="none" stroke="${annotation.color}" stroke-width="3"/>`
      }
      if (annotation.kind === "arrow") {
        const markerId = `arrow-${index}`
        return `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="${annotation.color}"/></marker></defs><line x1="${annotation.fromX}" y1="${annotation.fromY}" x2="${annotation.toX}" y2="${annotation.toY}" stroke="${annotation.color}" stroke-width="3" marker-end="url(#${markerId})"/>`
      }
      return `<text x="${annotation.left}" y="${annotation.top + 16}" fill="${annotation.color}" font-family="sans-serif" font-size="16" font-weight="600">${escapeXml(annotation.text)}</text>`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`
}

function assertRectangleInside(
  rectangleValue: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
  label: string,
) {
  if (
    rectangleValue.left + rectangleValue.width > width ||
    rectangleValue.top + rectangleValue.height > height
  ) {
    throw new Error(`${label} is outside image bounds.`)
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
