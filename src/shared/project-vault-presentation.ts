/** Hide only the exact seed envelope written by addSeedFrontmatter.
 * The source remains untouched for editing, saving and conflict recovery.
 */
export function projectVaultReadableContent(source: string, sectionId: string): string {
  const generated =
    /^---[ \t]*(\r?\n)flapstack-id: seed:([a-z]+)\r?\nflapstack-kind: seed\r?\nflapstack-section: ([a-z]+)\r?\n/.exec(
      source,
    )
  if (!generated || generated[2] !== sectionId || generated[3] !== sectionId) return source
  const rest = source.slice(generated[0].length)
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest)
  if (!closing) return source
  // Preserve all authored frontmatter, including whitespace and delimiters.
  if (closing.index > 0) return source.slice(0, source.indexOf("\n") + 1) + rest
  return rest.slice(closing[0].length)
}
