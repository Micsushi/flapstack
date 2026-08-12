import { describe, expect, it } from "vitest"
import { serializePromptParts } from "../src/shared/prompt-serialization"

describe("serializePromptParts", () => {
  it("combines text and hidden file context consistently", () => {
    expect(
      serializePromptParts([
        { type: "text", text: "Inspect this" },
        { type: "file-content", filePath: "src\\main.ts", content: "export {}" },
      ]),
    ).toBe("Inspect this\n--- main.ts ---\nexport {}")
  })

  it("ignores malformed and unrelated parts", () => {
    expect(serializePromptParts([null, { type: "image" }, { type: "text", text: "" }])).toBe("")
  })
})
