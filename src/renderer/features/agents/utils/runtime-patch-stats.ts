export type PatchStats = { additions: number; deletions: number }

export function runtimePatchStats(input: {
  filePath: string
  changeDiff?: string | null
  aggregateDiff?: string | null
  changeCount: number
}): PatchStats {
  if (input.changeDiff) return unifiedDiffStats(input.changeDiff)
  const aggregate = input.aggregateDiff ?? ""
  if (input.changeCount <= 1) return unifiedDiffStats(aggregate)
  const blocks = splitDiffBlocks(aggregate).filter((candidate) =>
    candidate.paths.some((path) => sameFile(path, input.filePath)),
  )
  return blocks.length === 1 ? unifiedDiffStats(blocks[0]!.diff) : { additions: 0, deletions: 0 }
}

function splitDiffBlocks(diff: string): Array<{ paths: string[]; diff: string }> {
  const lines = diff.replace(/\r\n/g, "\n").split("\n")
  const blocks: string[][] = []
  let current: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const standardHeaderPair =
      line.startsWith("--- ") &&
      Boolean(lines[index + 1]?.startsWith("+++ ")) &&
      !current.some(
        (candidate) =>
          candidate.startsWith("diff --git ") ||
          /^\*\*\* (?:Add|Update|Delete) File: /.test(candidate),
      )
    if (
      (line.startsWith("diff --git ") ||
        /^\*\*\* (?:Add|Update|Delete) File: /.test(line) ||
        standardHeaderPair) &&
      current.length
    ) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length) blocks.push(current)
  return blocks.map((blockLines) => ({
    paths: blockLines.flatMap(diffHeaderPaths),
    diff: blockLines.join("\n"),
  }))
}

function diffHeaderPaths(line: string): string[] {
  const git = line.match(/^diff --git a\/(.+) b\/(.+)$/)
  if (git) return [git[1]!, git[2]!]
  const file = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
  if (file) return [file[1]!]
  const standard = line.match(/^(?:---|\+\+\+) (?:[ab]\/)?([^\t]+)(?:\t.*)?$/)
  return standard && standard[1] !== "/dev/null" ? [standard[1]!] : []
}

function sameFile(candidate: string, requested: string): boolean {
  const left = candidate.replace(/^\.\//, "")
  const right = requested.replace(/^\.\//, "")
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

function unifiedDiffStats(diff: string): PatchStats {
  let additions = 0
  let deletions = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }
  return { additions, deletions }
}
