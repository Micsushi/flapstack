import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { z } from "zod"
import { VisualArtifactStore, type VisualArtifactRecord } from "./artifact-store"

const markerPattern =
  /^flapstack-visual-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{64})\.png$/i
const imageSchema = z
  .object({
    filename: z.string().min(1).max(512).optional(),
    mediaType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
    base64Data: z
      .string()
      .min(1)
      .max(48 * 1_048_576),
  })
  .strict()

export function visualCaptureAttachmentFilename(
  artifact: Pick<VisualArtifactRecord, "id" | "derivativeSha256">,
): string {
  return `flapstack-visual-${artifact.id}-${artifact.derivativeSha256}.png`
}

export async function bindVisualCaptureImagesToRun(input: {
  database: Database.Database
  artifactRoot: string
  chatId: string
  runId: string
  images: Array<{ filename?: string; mediaType: string; base64Data: string }> | null | undefined
}): Promise<string[]> {
  const store = new VisualArtifactStore(input.database, input.artifactRoot)
  const bound: string[] = []
  for (const imageValue of input.images ?? []) {
    const image = imageSchema.parse(imageValue)
    if (!image.filename?.startsWith("flapstack-visual-")) continue
    const marker = markerPattern.exec(image.filename)
    if (!marker) throw new Error("Visual capture attachment marker is invalid.")
    if (image.mediaType.toLowerCase() !== "image/png") {
      throw new Error("Visual capture attachment marker requires an image/png derivative.")
    }
    const [, artifactId, markerHash] = marker
    const bytes = decodeCanonicalBase64(image.base64Data)
    const bytesHash = sha256(bytes)
    if (bytesHash !== markerHash) {
      throw new Error("Visual capture attachment bytes do not match the marker hash.")
    }
    const verified = await store.readVerified(artifactId)
    if (verified.record.derivativeSha256 !== markerHash || !verified.bytes.equals(bytes)) {
      throw new Error("Visual capture attachment bytes do not match the confirmed artifact hash.")
    }
    const selected = input.database
      .prepare(
        `SELECT 1 FROM visual_artifact_links
          WHERE artifact_id = ? AND consumer_kind = 'chat' AND consumer_id = ?
            AND context_sha256 = ?`,
      )
      .get(artifactId, input.chatId, markerHash)
    if (!selected) {
      throw new Error("Visual capture artifact was not selected for this chat.")
    }
    store.link({ artifactId, consumerKind: "run", consumerId: input.runId })
    bound.push(artifactId)
  }
  return bound
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Visual capture attachment bytes are not canonical base64.")
  }
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) {
    throw new Error("Visual capture attachment bytes are not canonical base64.")
  }
  return bytes
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}
