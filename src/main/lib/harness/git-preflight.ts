import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type GitWorktreeSnapshot = {
  path: string
  headSha: string
  branch: string | null
  detached: boolean
  locked: boolean
  prunable: boolean
}

export type GitPreflightSnapshot = {
  repositoryRoot: string
  currentBranch: string | null
  headSha: string
  dirty: boolean
  worktrees: GitWorktreeSnapshot[]
}

const REPOSITORY_STATE_QUESTION =
  /\b(?:repo(?:sitory)?|status|progress|complete(?:d|ion)?|remaining|stage|worktree(?:s)?|branch(?:es)?|review|commit|head|diff|changes?)\b/i

export function isRepositoryStateQuestion(prompt: string): boolean {
  return REPOSITORY_STATE_QUESTION.test(prompt)
}

function parseWorktreeList(output: string): GitWorktreeSnapshot[] {
  return output
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const values = new Map<string, string>()
      const flags = new Set<string>()

      for (const line of block.split("\n")) {
        const separator = line.indexOf(" ")
        if (separator === -1) {
          flags.add(line)
        } else {
          values.set(line.slice(0, separator), line.slice(separator + 1))
        }
      }

      const path = values.get("worktree")
      const headSha = values.get("HEAD")
      if (!path || !headSha) return null

      const branchRef = values.get("branch")
      return {
        path,
        headSha,
        branch: branchRef?.replace(/^refs\/heads\//, "") ?? null,
        detached: flags.has("detached"),
        locked: flags.has("locked") || values.has("locked"),
        prunable: flags.has("prunable") || values.has("prunable"),
      }
    })
    .filter((worktree): worktree is GitWorktreeSnapshot => worktree !== null)
    .sort((left, right) => left.path.localeCompare(right.path))
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

export async function collectGitPreflightSnapshot(
  cwd: string,
): Promise<GitPreflightSnapshot | null> {
  try {
    const [repositoryRoot, currentBranch, headSha, status, worktreeList] = await Promise.all([
      runGit(cwd, ["rev-parse", "--show-toplevel"]),
      runGit(cwd, ["branch", "--show-current"]),
      runGit(cwd, ["rev-parse", "HEAD"]),
      runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=normal"]),
      runGit(cwd, ["worktree", "list", "--porcelain"]),
    ])

    return {
      repositoryRoot,
      currentBranch: currentBranch || null,
      headSha,
      dirty: status.length > 0,
      worktrees: parseWorktreeList(worktreeList),
    }
  } catch {
    return null
  }
}

export function formatGitPreflightSnapshot(snapshot: GitPreflightSnapshot): string {
  const worktrees = snapshot.worktrees
    .map((worktree) => {
      const branch = worktree.branch ?? (worktree.detached ? "detached" : "unknown")
      const flags = [worktree.locked ? "locked" : null, worktree.prunable ? "prunable" : null]
        .filter(Boolean)
        .join(", ")
      return `- ${worktree.path} | branch=${branch} | sha=${worktree.headSha}${flags ? ` | ${flags}` : ""}`
    })
    .join("\n")

  const evidenceRule =
    snapshot.worktrees.length > 1
      ? `Multiple worktrees exist. Before any repository-wide status, progress,
completion, remaining-work, stage, or branch claim, inspect the relevant live
worktrees/branches and authoritative task boards. Do not infer the answer from
the current checkout, memory, or a handoff alone.`
      : `Verify repository-wide claims against live Git state and authoritative
task boards. Memory and handoffs are leads only.`

  return `--- LIVE GIT PREFLIGHT ---
Repository root: ${snapshot.repositoryRoot}
Current branch: ${snapshot.currentBranch ?? "detached"}
Current HEAD: ${snapshot.headSha}
Current worktree dirty: ${snapshot.dirty ? "yes" : "no"}
Worktrees (${snapshot.worktrees.length}):
${worktrees || "- none reported by Git"}

Evidence rule: ${evidenceRule}
If the user says current, last, latest, or HEAD commit without naming another
ref, the review target is exactly ${snapshot.headSha} in
${snapshot.repositoryRoot}. Resolve and report the target before reviewing it.
This snapshot is routing evidence, not proof that a task is complete.
--- END LIVE GIT PREFLIGHT ---`
}
