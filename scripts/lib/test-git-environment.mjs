import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function createIsolatedTestGitEnvironment(options = {}) {
  const env = options.env ?? process.env
  const runner = options.spawn ?? spawnSync
  const directory = (
    options.makeDirectory ?? (() => mkdtempSync(join(tmpdir(), "flapstack-test-git-")))
  )()
  const configPath = join(directory, "config")
  const runGit = (args) => {
    const result = runner("git", args, {
      encoding: "utf8",
      env,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) {
      throw new Error(`Could not prepare isolated test Git config: ${args.join(" ")}`)
    }
    return String(result.stdout ?? "").trim()
  }
  const name = runGit(["config", "--global", "--get", "user.name"])
  const email = runGit(["config", "--global", "--get", "user.email"])
  if (!name || !email) throw new Error("Human Git name and email are required for tests")
  runGit(["config", "--file", configPath, "user.name", name])
  runGit(["config", "--file", configPath, "user.email", email])

  return {
    env: { ...env, GIT_CONFIG_GLOBAL: configPath },
    cleanup: () => (options.remove ?? rmSync)(directory, { recursive: true, force: true }),
  }
}

export function runWithIsolatedTestGitEnvironment(run, options = {}) {
  const isolated = (options.create ?? createIsolatedTestGitEnvironment)(options.environmentOptions)
  try {
    return run(isolated.env)
  } finally {
    isolated.cleanup()
  }
}
