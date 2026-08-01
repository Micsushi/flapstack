import { describe, expect, it } from "vitest"
import { parseObsidianNote } from "../src/main/lib/project-vaults/obsidian-markdown"

describe("Obsidian-compatible project note parser", () => {
  it("extracts reserved identity, aliases, tags, headings, blocks, wikilinks, and embeds", () => {
    const source = `---
flapstack_id: note-123
flapstack_type: decision
aliases: [Launch plan, Rollout]
tags:
  - stage6
  - release/windows
unrelated: preserved exactly
---
# Release Plan

See [[Architecture#Runtime|the runtime design]] and ![[diagram.png]].

Decision text. ^decision-one
`
    const parsed = parseObsidianNote(source, "plans/release.md")

    expect(parsed.identity).toEqual({ id: "note-123", type: "decision" })
    expect(parsed.aliases).toEqual(["Launch plan", "Rollout"])
    expect(parsed.tags).toEqual(["stage6", "release/windows"])
    expect(parsed.headings).toContainEqual(
      expect.objectContaining({ depth: 1, text: "Release Plan", slug: "release-plan" }),
    )
    expect(parsed.blocks).toContainEqual(expect.objectContaining({ id: "decision-one" }))
    expect(parsed.links).toEqual([
      expect.objectContaining({
        kind: "wikilink",
        target: "Architecture",
        heading: "Runtime",
        alias: "the runtime design",
      }),
      expect.objectContaining({
        kind: "embed",
        target: "diagram.png",
      }),
    ])
    expect(parsed.frontmatter.raw).toContain("unrelated: preserved exactly")
    expect(parsed.source).toBe(source)
  })

  it("ignores links in fenced and inline code and keeps malformed syntax byte-for-byte", () => {
    const source = `# Note

\`[[inline-secret]]\`

\`\`\`md
[[fenced-secret]]
\`\`\`

Broken [[link and [label](unterminated
`
    const parsed = parseObsidianNote(source, "note.md")

    expect(parsed.links).toEqual([])
    expect(parsed.source).toBe(source)
    expect(parsed.diagnostics.map((item) => item.code)).toContain("malformed-link")
  })

  it.each([
    ["[[../../outside]]", "path-escape"],
    ["[[/absolute/note]]", "path-escape"],
    ["[[C:\\\\secrets\\\\note.md]]", "path-escape"],
    ["[bad](%2e%2e/%2e%2e/private.md)", "path-escape"],
  ])("rejects unsafe target %s without guessing", (markup, code) => {
    const parsed = parseObsidianNote(markup, "folder/current.md")
    expect(parsed.links).toEqual([])
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code }))
  })

  it("normalizes relative Markdown links and Unicode keys deterministically", () => {
    const parsed = parseObsidianNote(
      "[Résumé](../RéSuMé/Plan%20A.md#Next%20Steps)",
      "notes/current.md",
    )

    expect(parsed.links).toEqual([
      expect.objectContaining({
        kind: "markdown",
        target: "../RéSuMé/Plan A.md",
        normalizedTarget: "résumé/plan a.md",
        heading: "Next Steps",
      }),
    ])
  })

  it("does not turn external URLs into graph nodes or expose secret-like frontmatter", () => {
    const parsed = parseObsidianNote(
      `---
flapstack_id: public-note
api_token: sk-example-should-not-project
---
[OpenAI](https://openai.com) [[Local]]
`,
      "safe.md",
    )

    expect(parsed.links.map((link) => link.target)).toEqual(["Local"])
    expect(JSON.stringify(parsed.identity)).not.toContain("sk-example")
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "secret-frontmatter" }),
    )
  })

  it("indexes bounded Obsidian inline tags outside code", () => {
    const parsed = parseObsidianNote(
      "# Tagged\n\n#stage6 #release/windows `#ignored`\n\nhttps://example.com/#fragment\n",
      "tagged.md",
    )

    expect(parsed.tags).toEqual(["stage6", "release/windows"])
  })

  it("fails boundedly on invalid encoding markers and oversized notes", () => {
    expect(() => parseObsidianNote("hello\u0000world", "note.md")).toThrow(/NUL/)
    expect(() => parseObsidianNote("x".repeat(1_048_577), "note.md")).toThrow(/size limit/)
  })
})
