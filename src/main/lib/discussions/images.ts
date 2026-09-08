import sharp from "sharp"
import type {
  DiscussionImagePreview,
  DiscussionSource,
  DiscussionImageSnapshot,
} from "../../../shared/discussions"

export const discussionImageLimits = {
  sourceBytes: 6 * 1024 * 1024,
  pixels: 16_000_000,
  edge: 768,
  modelMinimumEdge: 64,
  outputBytes: 256 * 1024,
} as const
const unavailable = (reason: string): DiscussionImagePreview => ({ available: false, reason })

/** Embedded bytes only. No remote URLs, filesystem paths, SVG, or animated frames. */
export async function cropDiscussionImage(
  raw: unknown,
  target: Extract<DiscussionSource["target"], { kind: "image" }>,
  hash: (value: unknown) => string,
): Promise<DiscussionImagePreview> {
  const message = raw as { parts?: unknown[]; content?: unknown }
  const parts =
    message.parts ??
    (Array.isArray(message.content)
      ? message.content
      : typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [])
  const part = parts[target.partIndex] as Record<string, any> | undefined
  if (!part) return unavailable("Image bytes are unavailable.")
  let candidate: unknown
  if (part.type === "text" && typeof part.text === "string") {
    const matches = Array.from(
      part.text.matchAll(/!\[[^\]\n]*\]\((?:<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g),
    )
    const match = matches.find(
      (match) => hash({ markdown: match[0], offset: match.index }) === target.imageIdentity,
    )
    candidate = match?.[0].match(/!\[[^\]\n]*\]\(<?([^\s)>]+)/)?.[1]
  } else {
    const data = part.data
    candidate =
      typeof data?.base64Data === "string" && typeof data?.mediaType === "string"
        ? `data:${data.mediaType};base64,${data.base64Data}`
        : (data?.url ??
          part.url ??
          part.image ??
          (typeof part.image_url === "string" ? part.image_url : part.image_url?.url))
  }
  if (typeof candidate !== "string" || !candidate.startsWith("data:"))
    return unavailable(
      "This image has no embedded pixels. External URLs and files are not fetched.",
    )
  const match = candidate.match(
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/,
  )
  if (
    !match ||
    !match[2] ||
    match[2].length % 4 !== 0 ||
    match[2].length > Math.ceil(discussionImageLimits.sourceBytes / 3) * 4
  )
    return unavailable("Embedded image is invalid, unsupported, or exceeds the image size limit.")
  const bytes = Buffer.from(match[2], "base64")
  if (bytes.length > discussionImageLimits.sourceBytes || bytes.toString("base64") !== match[2])
    return unavailable("Embedded image exceeds the size limit or has invalid encoding.")
  try {
    const image = sharp(bytes, {
      limitInputPixels: discussionImageLimits.pixels,
      failOn: "warning",
    })
    const metadata = await image.metadata()
    if (
      !metadata.width ||
      !metadata.height ||
      !["png", "jpeg", "webp", "gif"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1
    )
      return unavailable("Unsupported image format or animated image.")
    // Orient before interpreting the normalized region, matching normal image display.
    const oriented = await image.rotate().toBuffer({ resolveWithObject: true })
    const { width, height } = oriented.info,
      region = target.region
    const left = Math.min(width - 1, Math.floor(region.x * width)),
      top = Math.min(height - 1, Math.floor(region.y * height))
    const cropWidth = Math.max(
      1,
      Math.min(width - left, Math.ceil((region.x + region.width) * width) - left),
    )
    const cropHeight = Math.max(
      1,
      Math.min(height - top, Math.ceil((region.y + region.height) * height) - top),
    )
    const result = await sharp(oriented.data, { limitInputPixels: discussionImageLimits.pixels })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({
        width: discussionImageLimits.edge,
        height: discussionImageLimits.edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    if (result.data.length > discussionImageLimits.outputBytes)
      return unavailable("Selected crop exceeds the snapshot size limit. Select a smaller region.")
    return {
      available: true,
      imageSnapshot: {
        dataUrl: `data:image/png;base64,${result.data.toString("base64")}`,
        width: result.info.width,
        height: result.info.height,
      },
    }
  } catch {
    return unavailable("Embedded image could not be decoded within the image limits.")
  }
}

export class DiscussionImagePreparationError extends Error {}

/** Enlarge only the model input. Nearest-neighbor sampling adds no surrounding image context. */
export async function prepareDiscussionModelImage(
  snapshot: DiscussionImageSnapshot,
): Promise<DiscussionImageSnapshot> {
  try {
    const encoded = snapshot.dataUrl.slice("data:image/png;base64,".length)
    const bytes = Buffer.from(encoded, "base64")
    if (
      !snapshot.dataUrl.startsWith("data:image/png;base64,") ||
      bytes.length > discussionImageLimits.outputBytes ||
      bytes.toString("base64") !== encoded
    )
      throw new Error("Invalid snapshot")
    const image = sharp(bytes, {
      limitInputPixels: discussionImageLimits.edge ** 2,
      failOn: "warning",
    })
    const metadata = await image.metadata()
    const width = metadata.width,
      height = metadata.height
    if (
      metadata.format !== "png" ||
      !width ||
      !height ||
      width !== snapshot.width ||
      height !== snapshot.height ||
      Math.max(width, height) > discussionImageLimits.edge ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Invalid snapshot")
    if (Math.min(width, height) >= discussionImageLimits.modelMinimumEdge) return snapshot
    const scale = discussionImageLimits.modelMinimumEdge / Math.min(width, height)
    if (Math.round(Math.max(width, height) * scale) > discussionImageLimits.edge)
      throw new DiscussionImagePreparationError(
        "This crop is too narrow for the local image model. Select a wider or larger region.",
      )
    const result = await image
      .resize({
        width: width <= height ? discussionImageLimits.modelMinimumEdge : undefined,
        height: height < width ? discussionImageLimits.modelMinimumEdge : undefined,
        kernel: "nearest",
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    if (result.data.length > discussionImageLimits.outputBytes)
      throw new DiscussionImagePreparationError(
        "This crop exceeds the local image size limit after enlargement. Select a larger region with less detail.",
      )
    return {
      dataUrl: `data:image/png;base64,${result.data.toString("base64")}`,
      width: result.info.width,
      height: result.info.height,
    }
  } catch (error) {
    if (error instanceof DiscussionImagePreparationError) throw error
    throw new DiscussionImagePreparationError(
      "The saved image crop could not be prepared. Select the image region again.",
    )
  }
}
