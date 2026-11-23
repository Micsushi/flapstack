import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ChatMarkdownRenderer } from "../src/renderer/components/chat-markdown-renderer"

vi.mock("../src/renderer/lib/hooks/use-code-theme", () => ({
  useCodeTheme: () => "github-light",
}))

describe("local file references in replies", () => {
  it("keeps the filenames from Codex and Gemini without turning local paths into links", () => {
    const content = [
      "[Codex result](<C:/sample project/result.json>)",
      "[Gemini result](file:///C:/sample/project/result.json)",
      "[Reference](https://example.com/guide)",
    ].join("\n\n")
    const html = renderToStaticMarkup(<ChatMarkdownRenderer content={content} />)
    expect(html).toContain("Codex result")
    expect(html).toContain("Gemini result")
    expect(html).not.toContain("[blocked]")
    expect(html).not.toContain("sample")
    expect(html).toContain('href="https://example.com/guide"')
  })
})
