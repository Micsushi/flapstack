import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFileInsideRoot } from "../path-safety"
import { splitUnifiedDiffByFile } from "../git/diff-parser"
import { afterProcessClose } from "../git/closed-process"

const exec = promisify(execFile)
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const imageLimit = 4 * 1024 * 1024

/** A bounded plain-text page avoids syntax-highlighting an entire large patch. */
export function reviewPage(diff: string, offset: number) {
  let left = 0,
    right = 0
  const lines = diff.split("\n")
  const rows: { text: string; left: number | null; right: number | null; truncated: boolean }[] = []
  for (let index = 0; index < Math.min(lines.length, offset + 200); index++) {
    const text = lines[index]!
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    let oldLine: number | null = null,
      newLine: number | null = null
    if (hunk) {
      left = Number(hunk[1])
      right = Number(hunk[2])
    } else if (left || right) {
      if (text.startsWith("-")) oldLine = left++
      else if (text.startsWith("+")) newLine = right++
      else if (text.startsWith(" ")) {
        oldLine = left++
        newLine = right++
      }
    }
    if (index >= offset)
      rows.push({
        text: text.slice(0, 2000),
        left: oldLine,
        right: newLine,
        truncated: text.length > 2000,
      })
  }
  return {
    kind: "text" as const,
    rows,
    offset,
    total: lines.length,
    next: offset + rows.length < lines.length ? offset + rows.length : null,
  }
}

function raster(buffer: Buffer) {
  const mime = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())
        ? "image/gif"
        : buffer.subarray(0, 4).toString() === "RIFF" &&
            buffer.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null
  if (!mime) throw new Error("Preview supports PNG, JPEG, GIF and WebP images.")
  // Check declared dimensions before Chromium allocates decoded pixel storage.
  let width = 0,
    height = 0
  if (mime === "image/png" && buffer.length >= 24) {
    width = buffer.readUInt32BE(16)
    height = buffer.readUInt32BE(20)
  }
  if (mime === "image/gif" && buffer.length >= 10) {
    width = buffer.readUInt16LE(6)
    height = buffer.readUInt16LE(8)
  }
  if (mime === "image/jpeg") {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 255) break
      const marker = buffer[offset + 1]!,
        length = buffer.readUInt16BE(offset + 2)
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = buffer.readUInt16BE(offset + 5)
        width = buffer.readUInt16BE(offset + 7)
        break
      }
      if (length < 2) break
      offset += 2 + length
    }
  }
  if (mime === "image/webp" && buffer.length >= 30) {
    const chunk = buffer.subarray(12, 16).toString()
    if (chunk === "VP8X") {
      width = 1 + buffer.readUIntLE(24, 3)
      height = 1 + buffer.readUIntLE(27, 3)
    }
    if (chunk === "VP8 " && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = buffer.readUInt16LE(26) & 0x3fff
      height = buffer.readUInt16LE(28) & 0x3fff
    }
    if (chunk === "VP8L" && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000)
    throw new Error("Image dimensions are unavailable or exceed the 16 megapixel preview limit.")
  return { hash: digest(buffer), dataUrl: `data:${mime};base64,${buffer.toString("base64")}` }
}

export async function readDiffReview(
  root: string,
  diff: string,
  fileKey: string,
  offset: number,
  signal?: AbortSignal,
) {
  // ponytail: rescan the bounded 8 MiB snapshot per page; index only if profiling warrants it.
  const file = splitUnifiedDiffByFile(diff).find((row) => row.key === fileKey)
  if (!file) throw new Error("This file is no longer in the diff. Refresh the review.")
  if (!file.isBinary) return reviewPage(file.diffText, offset)
  // Resolve HEAD once, so a concurrent commit cannot mix historical image identities.
  const git = async (args: string[]) =>
    (
      await afterProcessClose(
        exec("git", ["-c", "core.fsmonitor=false", ...args], {
          cwd: root,
          encoding: "buffer",
          maxBuffer: imageLimit,
          timeout: 10000,
          windowsHide: true,
          signal,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        }),
      )
    ).stdout
  const isNew = file.diffText.includes("new file mode ") || file.oldPath === "/dev/null"
  const isDeleted = file.diffText.includes("deleted file mode ") || file.newPath === "/dev/null"
  const head = isNew ? null : (await git(["rev-parse", "--verify", "HEAD"])).toString().trim()
  const before = head ? raster(await git(["cat-file", "blob", `${head}:${file.oldPath}`])) : null
  const afterBytes = isDeleted
    ? null
    : await readFileInsideRoot(root, file.newPath, { maxBytes: imageLimit })
  signal?.throwIfAborted()
  const after = afterBytes ? raster(afterBytes) : null
  // Retain one byte snapshot; the caller also revalidates the observed diff.
  if (
    after &&
    digest(await readFileInsideRoot(root, file.newPath, { maxBytes: imageLimit })) !== after.hash
  )
    throw new Error("Image changed while loading. Retry the preview.")
  return { kind: "image" as const, before, after }
}
