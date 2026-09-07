import { execFile, spawn } from "node:child_process"
import { realpathSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"

const kindSchema = z.enum(["architecture", "workflow", "sequence", "dataflow", "lifecycle"])
const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: z.literal("validate"),
    type: kindSchema,
    input: z.string(),
    ok: z.boolean(),
  })
  .passthrough()

function stop(child) {
  if (!child.pid) return
  if (process.platform === "win32") {
    if (child.exitCode != null || child.signalCode != null) return
    execFile(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", "/f"],
      { windowsHide: true, timeout: 5_000 },
      () => {
        if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL")
      },
    )
  } else {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch (error) {
      if (error.code !== "ESRCH") child.kill("SIGKILL")
    }
  }
}

export async function validateWithArchify({
  cliPath,
  workspaceRoot,
  inputPath,
  kind,
  signal,
  timeoutMs = 30_000,
}) {
  kindSchema.parse(kind)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000)
    throw new Error("Archify timeout must be between 1 and 30000 milliseconds")
  if (!cliPath || !path.isAbsolute(cliPath))
    throw new Error("Set FLAPSTACK_ARCHIFY_CLI to an absolute trusted Archify CLI path")
  const cli = realpathSync(cliPath)
  if (path.extname(cli) !== ".mjs" || !statSync(cli).isFile())
    throw new Error("Archify CLI must be an installed .mjs file")
  const root = realpathSync(workspaceRoot)
  const input = realpathSync(path.resolve(root, inputPath))
  const relative = path.relative(root, input)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Archify input must remain inside the selected workspace")
  const stat = statSync(input)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
    throw new Error("Archify input must be a file no larger than 2 MiB")
  if (signal?.aborted) throw new Error("Archify validation cancelled")

  // No provider credentials, Node injection options, or browser-open flags.
  // This trusted CLI process is not an OS sandbox.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["path", "systemroot", "windir", "temp", "tmp", "tmpdir"].includes(key.toLowerCase()),
    ),
  )
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "validate", kind, input, "--json"], {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const output = []
    let bytes = 0
    let failure
    const cancel = (message) => {
      if (failure) return
      failure = new Error(message)
      stop(child)
      // Descendants can inherit pipe handles after the CLI exits. Do not let
      // those handles keep a cancelled request pending indefinitely.
      child.stdout.destroy()
      child.stderr.destroy()
    }
    const abort = () => cancel("Archify validation cancelled")
    const timer = setTimeout(() => cancel("Archify validation timed out"), timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 1024 * 1024) cancel("Archify output exceeded 1 MiB")
        else if (stream === child.stdout) output.push(chunk)
      })
    child.on("error", (error) => {
      failure ??= error
    })
    child.on("close", (status, exitSignal) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (failure) {
        reject(failure)
        return
      }
      try {
        if (exitSignal) throw new Error(`Archify terminated by ${exitSignal}`)
        const receipt = receiptSchema.parse(JSON.parse(Buffer.concat(output).toString("utf8")))
        if (
          receipt.type !== kind ||
          !path.isAbsolute(receipt.input) ||
          path.resolve(receipt.input) !== input
        )
          throw new Error("Archify receipt does not match the requested input")
        if ((status === 0) !== receipt.ok)
          throw new Error("Archify exit status contradicts its receipt")
        if (
          receipt.ok &&
          (!Array.isArray(receipt.checks) ||
            receipt.checks.length === 0 ||
            !receipt.checks.every((check) => check?.ok === true) ||
            receipt.composition?.summary?.errors !== 0)
        )
          throw new Error("Archify success receipt is missing passing artifact checks")
        if (!receipt.ok && typeof receipt.error !== "string")
          throw new Error("Archify failure receipt is missing its error")
        resolve(receipt)
      } catch (error) {
        reject(error)
      }
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    const [kind, inputPath, ...extra] = process.argv.slice(2)
    if (!kind || !inputPath || extra.length)
      throw new Error("Usage: npm run archify:validate -- KIND INPUT.json")
    const receipt = await validateWithArchify({
      cliPath: process.env.FLAPSTACK_ARCHIFY_CLI,
      workspaceRoot: process.cwd(),
      inputPath,
      kind,
      signal: controller.signal,
    })
    console.log(JSON.stringify(receipt))
    process.exitCode = receipt.ok ? 0 : 1
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }))
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}
