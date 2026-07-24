import { spawnSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function createIsolatedTestGitEnvironment(options = {}) {
  const env = options.env ?? process.env
  const testEnv = { ...env }
  if ((options.platform ?? process.platform) === "win32") {
    const realpath = options.realpath ?? realpathSync.native
    for (const key of ["TEMP", "TMP", "TMPDIR"]) {
      if (!testEnv[key]) continue
      try {
        testEnv[key] = realpath(testEnv[key])
      } catch {
        // Keep the original path so the child command can report an invalid temp directory.
      }
    }
  }
  const runner = options.spawn ?? spawnSync
  const directory = (
    options.makeDirectory ?? (() => mkdtempSync(join(tmpdir(), "flapstack-test-git-")))
  )()
  const configPath = join(directory, "config")
  const runGit = (args) => {
    const result = runner("git", args, {
      encoding: "utf8",
      env: testEnv,
      windowsHide: true,
    })
    if (result.error || result.status !== 0) {
      throw new Error(`Could not prepare isolated test Git config: ${args.join(" ")}`)
    }
    return String(result.stdout ?? "").trim()
  }
  const readGlobalConfig = (key) => {
    const result = runner("git", ["config", "--global", "--get", key], {
      encoding: "utf8",
      env: testEnv,
      windowsHide: true,
    })
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      throw new Error(`Could not prepare isolated test Git config: config --global --get ${key}`)
    }
    return String(result.stdout ?? "").trim()
  }
  const globalName = readGlobalConfig("user.name")
  const globalEmail = readGlobalConfig("user.email")
  const hasGlobalIdentity = Boolean(globalName && globalEmail)
  const name = hasGlobalIdentity ? globalName : "Flapstack Test"
  const email = hasGlobalIdentity ? globalEmail : "flapstack-test@example.invalid"
  runGit(["config", "--file", configPath, "user.name", name])
  runGit(["config", "--file", configPath, "user.email", email])

  return {
    env: { ...testEnv, GIT_CONFIG_GLOBAL: configPath },
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
