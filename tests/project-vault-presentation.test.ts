import { expect, it } from "vitest"
import { projectVaultReadableContent } from "../src/shared/project-vault-presentation"

const envelope = "---\nflapstack-id: seed:index\nflapstack-kind: seed\nflapstack-section: index\n"
it("hides generated seed metadata while preserving the authored body byte for byte", () => {
  for (const newline of ["\n", "\r\n"]) {
    const body = "# Quasar navigation\n\nKeep `flapstack-id` in examples.\n".replaceAll(
      "\n",
      newline,
    )
    const source = envelope.replaceAll("\n", newline) + "---" + newline + body
    expect(projectVaultReadableContent(source, "index")).toBe(body)
    expect(source).toContain("flapstack-kind: seed")
  }
})
it("preserves authored frontmatter rather than deleting the whole header", () => {
  const authored = "title: My note\ntags: [work]\n---\n# Body\n"
  expect(projectVaultReadableContent(envelope + authored, "index")).toBe("---\n" + authored)
})
it.each([
  "---\ntitle: User note\n---\n# Body",
  envelope + "# No closing delimiter",
  envelope.replace("seed:index", "seed:handoff") + "---\n# Body",
  "# Example\n" + envelope + "---\n",
  envelope.replace("flapstack-kind: seed", "flapstack-kind: custom") + "---\n",
])("preserves unrelated or malformed text (%#)", (source) => {
  expect(projectVaultReadableContent(source, "index")).toBe(source)
})
