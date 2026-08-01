import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { normalizeNonImageAttachmentMimeType } from "../src/shared/attachment-mime"

describe("renderer attachment MIME declarations", () => {
  it.each([
    ["text/plain", "text/plain"],
    ["TEXT/MARKDOWN", "text/markdown"],
    [" application/pdf ", "application/pdf"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ])("preserves bounded allowlisted non-image MIME %j", (declared, expected) => {
    expect(normalizeNonImageAttachmentMimeType(declared)).toBe(expected)
  })

  it.each(["", "application/x-private", "image/png", `text/plain${" ".repeat(256)}`])(
    "falls back for empty, untrusted, image, or oversized MIME %j",
    (declared) => {
      expect(normalizeNonImageAttachmentMimeType(declared)).toBe("application/octet-stream")
    },
  )

  it("uses the bounded normalizer for non-image renderer imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer/features/agents/main/active-chat.tsx"),
      "utf8",
    )

    expect(source).toContain("normalizeNonImageAttachmentMimeType(file.type)")
    expect(source).toContain("file.size > MAX_ATTACHMENT_BYTES")
    expect(source.indexOf("file.size > MAX_ATTACHMENT_BYTES")).toBeLessThan(
      source.indexOf("file.arrayBuffer()"),
    )
  })
})
