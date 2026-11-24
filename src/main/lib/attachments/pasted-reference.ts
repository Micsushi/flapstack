import { lstat, realpath } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { actOnPathInsideRoot } from "../path-safety"

const textAttachmentReference = /@\[(pasted|chatHistory):[0-9]+:[^|\]\n]*\|([^\]\r\n]+)\]/g

export function omitTextAttachmentReferences(text: string) {
  return text.replace(textAttachmentReference, (_reference, kind: string) =>
    kind === "pasted" ? "[Pasted attachment omitted]" : "[Chat history attachment omitted]",
  )
}

export async function linkPastedText(
  text: string,
  profile: string,
  ownerIds: readonly string[],
): Promise<string> {
  const matches = [...text.matchAll(textAttachmentReference)].filter(
    (match) => match[1] === "pasted",
  )
  if (!matches.length) return text
  const root = await realpath(profile)
  const owners = ownerIds.filter((id) => /^[a-z0-9_-]+$/i.test(id))
  const verified = new Map<string, string>()
  for (const match of matches) {
    const path = match[2]!
    if (verified.has(path)) continue
    verified.set(path, "[Pasted attachment unavailable]")
    if (!isAbsolute(path)) continue
    const name = basename(path)
    if (!/^pasted_[0-9]+\.txt$/.test(name)) continue
    const candidateRoot = [resolve(profile), root].find((directory) =>
      owners.some((owner) => {
        const scoped = relative(join(directory, "claude-sessions", owner, "pasted"), path)
        return scoped === name
      }),
    )
    if (!candidateRoot) continue
    try {
      const target = await actOnPathInsideRoot(
        root,
        relative(candidateRoot, path),
        async (file) => {
          const stat = await lstat(file)
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular paste")
          return file
        },
      )
      if (target.split(sep).at(-1) === name)
        verified.set(
          path,
          "[Pasted text file. Read only if needed: " + JSON.stringify(target) + "]",
        )
    } catch {
      // Deleted, moved, or redirected attachments cannot enter the provider request.
    }
  }
  return text.replace(textAttachmentReference, (reference, kind: string, path: string) =>
    kind === "pasted" ? verified.get(path)! : reference,
  )
}
