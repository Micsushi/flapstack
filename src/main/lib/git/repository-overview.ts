import simpleGit from "simple-git"
import { resolve } from "node:path"

export type RepositoryWorktree = {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isCurrent: boolean
  isDetached: boolean
  isLocked: boolean
  prunableReason: string | null
  dirtyCount: number
  stagedCount: number
  modifiedCount: number
  untrackedCount: number
  conflictedCount: number
}

export type RepositoryBranch = {
  name: string
  kind: "local" | "remote"
  head: string
  lastCommitAt: number
  upstream: string | null
  ahead: number
  behind: number
  uniqueCommits: number
  mergedIntoDefault: boolean
  checkedOutPath: string | null
}

function parseWorktrees(
  raw: string,
): Omit<
  RepositoryWorktree,
  | "dirtyCount"
  | "stagedCount"
  | "modifiedCount"
  | "untrackedCount"
  | "conflictedCount"
  | "isMain"
  | "isCurrent"
>[] {
  return raw
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const value = (prefix: string) =>
        lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? null
      return {
        path: value("worktree ") ? resolve(value("worktree ")!) : "",
        head: value("HEAD ") ?? "",
        branch: value("branch ")?.replace(/^refs\/heads\//, "") ?? null,
        isDetached: lines.includes("detached"),
        isLocked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
        prunableReason: value("prunable "),
      }
    })
    .filter((worktree) => worktree.path)
}

export async function getRepositoryOverview(projectPath: string) {
  const git = simpleGit(projectPath)
  const [root, worktreeRaw, currentBranch] = await Promise.all([
    git.revparse(["--show-toplevel"]),
    git.raw(["worktree", "list", "--porcelain"]),
    git.revparse(["--abbrev-ref", "HEAD"]),
  ])
  let defaultBranch = "main"
  try {
    defaultBranch = (await git.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))
      .trim()
      .replace(/^origin\//, "")
  } catch {
    const local = await git.branchLocal()
    if (!local.all.includes("main") && local.all.includes("master")) defaultBranch = "master"
  }

  const parsedWorktrees = parseWorktrees(worktreeRaw)
  const worktrees: RepositoryWorktree[] = await Promise.all(
    parsedWorktrees.map(async (worktree, index) => {
      let dirtyCount = 0
      let stagedCount = 0
      let modifiedCount = 0
      let untrackedCount = 0
      let conflictedCount = 0
      try {
        const status = await simpleGit(worktree.path).status()
        dirtyCount = status.files.length
        stagedCount = status.staged.length
        modifiedCount = status.modified.length + status.deleted.length + status.renamed.length
        untrackedCount = status.not_added.length
        conflictedCount = status.conflicted.length
      } catch {}
      return {
        ...worktree,
        dirtyCount,
        stagedCount,
        modifiedCount,
        untrackedCount,
        conflictedCount,
        isMain:
          index === 0 || worktree.path.toLocaleLowerCase() === root.trim().toLocaleLowerCase(),
        isCurrent:
          worktree.path.toLocaleLowerCase() === projectPath.toLocaleLowerCase() ||
          worktree.branch === currentBranch.trim(),
      }
    }),
  )
  const checkedOut = new Map(
    worktrees.filter((item) => item.branch).map((item) => [item.branch!, item.path]),
  )
  const branchRaw = await git.raw([
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(committerdate:unix)%00%(upstream:short)%00%(upstream:track)",
    "refs/heads/",
    "refs/remotes/",
  ])
  const merged = new Set(
    (
      await git
        .raw(["branch", "--format=%(refname:short)", "--merged", defaultBranch])
        .catch(() => "")
    )
      .split(/\r?\n/)
      .filter(Boolean),
  )
  const branchCandidates = await Promise.all(
    branchRaw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(async (line) => {
        const [
          refName = "",
          rawName = "",
          head = "",
          timestamp = "0",
          upstream = "",
          tracking = "",
        ] = line.split("\0")
        const kind = refName.startsWith("refs/remotes/") ? "remote" : "local"
        const name = rawName
        if (kind === "remote" && name.endsWith("/HEAD")) return null
        const ahead = Number(tracking.match(/ahead (\d+)/)?.[1] ?? 0)
        const behind = Number(tracking.match(/behind (\d+)/)?.[1] ?? 0)
        let uniqueCommits = 0
        const ref = rawName
        if (ref !== defaultBranch && ref !== `origin/${defaultBranch}`) {
          uniqueCommits =
            Number(
              (
                await git.raw(["rev-list", "--count", `${defaultBranch}..${ref}`]).catch(() => "0")
              ).trim(),
            ) || 0
        }
        let mergedIntoDefault = name === defaultBranch || merged.has(name)
        if (kind === "remote" && name !== `origin/${defaultBranch}`) {
          mergedIntoDefault = await git
            .raw(["merge-base", "--is-ancestor", ref, defaultBranch])
            .then(() => true)
            .catch(() => false)
        }
        return {
          name,
          kind,
          head,
          lastCommitAt: Number(timestamp) * 1000,
          upstream: upstream || null,
          ahead,
          behind,
          uniqueCommits,
          mergedIntoDefault,
          checkedOutPath: kind === "local" ? (checkedOut.get(name) ?? null) : null,
        }
      }),
  )
  const branches = branchCandidates.filter((branch): branch is RepositoryBranch => branch !== null)
  return {
    projectPath: root.trim(),
    defaultBranch,
    worktrees,
    branches,
  }
}
