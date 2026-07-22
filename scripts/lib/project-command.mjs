import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

function packageDirectory(root, packageName) {
  return path.join(root, "node_modules", ...packageName.split("/"))
}

const NON_PORTABLE_SCRIPT_PATTERNS = [
  /\bsh\s+-c\b/,
  /\brm\s+-rf\b/,
  /(?:^|\s)[A-Z_][A-Z0-9_]*=[^\s]+\s/,
]

export function assertPortablePackageScripts(manifest, requiredNames) {
  for (const name of requiredNames) {
    const command = manifest?.scripts?.[name]
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error(`Missing required npm script: ${name}`)
    }
    if (NON_PORTABLE_SCRIPT_PATTERNS.some((pattern) => pattern.test(command))) {
      throw new Error(`npm script ${name} is not portable: ${command}`)
    }
  }
}

export function resolvePackageBin(packageName, binName, options = {}) {
  const root = path.resolve(options.root ?? process.cwd())
  const directory = packageDirectory(root, packageName)
  const manifestPath = path.join(directory, "package.json")
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    throw new Error(`Could not read ${packageName} package manifest at ${manifestPath}`, {
      cause: error,
    })
  }

  const declared =
    typeof manifest.bin === "string"
      ? binName === packageName.split("/").at(-1)
        ? manifest.bin
        : undefined
      : manifest.bin?.[binName]
  if (typeof declared !== "string" || declared.length === 0) {
    throw new Error(`${packageName} does not declare bin ${binName}`)
  }

  const resolved = path.resolve(directory, declared)
  const relative = path.relative(directory, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${packageName} bin ${binName} escapes its package directory`)
  }
  return resolved
}

export function runCommandSequence(steps, options = {}) {
  const runner = options.runner ?? spawnSync
  for (const step of steps) {
    if (!step?.label || !step?.command) throw new Error("Command steps require label and command")
    if (!options.quiet) console.log(`[command] ${step.label}`)
    const result = runner(step.command, step.args ?? [], {
      cwd: step.cwd ?? options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env, ...step.env },
      stdio: step.stdio ?? options.stdio ?? "inherit",
    })
    if (result.error) {
      throw new Error(`${step.label} could not start: ${result.error.message}`, {
        cause: result.error,
      })
    }
    if (result.signal) throw new Error(`${step.label} terminated by ${result.signal}`)
    if (result.status !== 0) throw new Error(`${step.label} failed with exit code ${result.status}`)
  }
}

export function packageBinStep(label, packageName, binName, args = [], options = {}) {
  const root = path.resolve(options.root ?? process.cwd())
  return {
    label,
    command: process.execPath,
    args: [resolvePackageBin(packageName, binName, { root }), ...args],
    cwd: root,
    env: options.env,
  }
}
