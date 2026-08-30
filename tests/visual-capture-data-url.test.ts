import { describe, expect, it } from "vitest"
import { dataUrlToBlob } from "../src/renderer/features/agents/utils/base64"

describe("visual capture data URLs", () => {
  it("decodes a base64 image without using renderer fetch", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AQIDBA==")

    expect(blob.type).toBe("image/png")
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4])
  })

  it("rejects malformed derivatives", () => {
    expect(() => dataUrlToBlob("https://example.test/capture.png")).toThrow(
      "Visual capture derivative is not a base64 data URL.",
    )
  })
})
