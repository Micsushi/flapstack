import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { gunzipSync } from "node:zlib"

let startupFailure: string | undefined
const managedConnections = new WeakMap<
  NodeJS.ProcessEnv,
  { endpoint: string; tokenFile?: string; token?: string }
>()
export function managedRecordsConnection(env = process.env) {
  return managedConnections.get(env)
}
export function projectRecordsStartupFailure(): string | undefined {
  return startupFailure
}

export async function startProjectRecordsRuntime(options: {
  userData: string
  snapshotPath: string
  env?: NodeJS.ProcessEnv
}): Promise<() => void> {
  startupFailure = undefined
  managedConnections.delete(options.env ?? process.env)
  try {
    return await startRuntime(options)
  } catch (error) {
    // OS errors may contain private paths; the console retains those diagnostics.
    startupFailure =
      error instanceof Error && !("code" in error)
        ? error.message
        : "Records could not access its local runtime or data. Check the configured paths and permissions, then restart."
    throw error
  }
}

// Only this app's child is stopped. An externally connected service is never owned.
async function startRuntime(options: {
  userData: string
  snapshotPath: string
  env?: NodeJS.ProcessEnv
}): Promise<() => void> {
  const env = options.env ?? process.env
  const endpoint = env.FLAPSTACK_PROJECT_RECORDS_URL
  const token = env.FLAPSTACK_PROJECT_RECORDS_TOKEN
  const tokenFile = env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE
  // Capture before validation so even rejected configurations cannot leak owner auth.
  delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN
  delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE
  delete env.PROJECT_RECORDS_TOKEN
  delete env.PROJECT_RECORDS_TOKEN_FILE
  const mode =
    env.FLAPSTACK_PROJECT_RECORDS_MODE ??
    (endpoint || token || tokenFile ? "connected" : "standalone")
  // Select authority before any startup operation can fail; never fall back to legacy tasks.
  env.FLAPSTACK_PROJECT_RECORDS_MODE = mode
  if (mode === "connected") {
    if (!endpoint) throw new Error("Connected Records requires FLAPSTACK_PROJECT_RECORDS_URL.")
    managedConnections.set(env, { endpoint, tokenFile, token })
    return () => {}
  }
  if (mode !== "standalone") throw new Error("Unknown Project Records mode.")
  if (endpoint || token || tokenFile)
    throw new Error("Standalone Records cannot also configure an external connection.")
  const root = resolve(
    env.FLAPSTACK_PROJECT_RECORDS_DATA ?? join(options.userData, "project-records"),
  )
  await mkdir(root, { recursive: true })
  const packed = await readFile(options.snapshotPath).catch(() => {
    throw new Error(
      "Bundled Records runtime is missing or unreadable. Reinstall the complete Flapstack package, then restart.",
    )
  })
  const digest = createHash("sha256").update(packed).digest("hex")
  const runtime = join(options.userData, "records-runtime", digest)
  const snapshot = JSON.parse(gunzipSync(packed).toString("utf8")) as {
    files: Record<string, string>
  }
  for (const [name, content] of Object.entries(snapshot.files)) {
    const target = resolve(runtime, name)
    if (
      isAbsolute(name) ||
      !target.startsWith(resolve(runtime) + sep) ||
      typeof content !== "string"
    )
      throw new Error("Invalid bundled Records runtime path.")
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const python = env.FLAPSTACK_PROJECT_RECORDS_PYTHON || "python"
  const writer = join(runtime, "writer.py")
  const database = join(root, "records.sqlite3")
  const desktopTokenFile = join(root, "desktop-token")
  try {
    await writeFile(desktopTokenFile, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  }
  delete childEnv.PROJECT_RECORDS_TOKEN
  delete childEnv.PROJECT_RECORDS_TOKEN_FILE
  if (!existsSync(database)) {
    await new Promise<void>((accept, reject) => {
      const child = spawn(python, [writer, "init-sql", "--root", root, "--database", database], {
        env: childEnv,
        windowsHide: true,
        stdio: "ignore",
      })
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error("Records initialization timed out."))
      }, 30_000)
      child.once("error", () => {
        clearTimeout(timeout)
        reject(new Error("Records requires Python 3. Configure FLAPSTACK_PROJECT_RECORDS_PYTHON."))
      })
      child.once("exit", (code) => {
        clearTimeout(timeout)
        code === 0
          ? accept()
          : reject(
              new Error("Records database initialization failed; existing data was not replaced."),
            )
      })
    })
  }
  const child = spawn(
    python,
    [
      writer,
      "serve",
      "--root",
      root,
      "--database",
      database,
      "--token-file",
      desktopTokenFile,
      "--port",
      "0",
    ],
    { env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  )
  const stop = () => {
    if (child.exitCode === null) child.kill()
  }
  try {
    const endpoint = await new Promise<string>((accept, reject) => {
      let output = ""
      const timeout = setTimeout(() => reject(new Error("Records startup timed out.")), 30_000)
      child.once("error", () => {
        clearTimeout(timeout)
        reject(new Error("Records requires Python 3. Configure FLAPSTACK_PROJECT_RECORDS_PYTHON."))
      })
      child.once("exit", () => {
        clearTimeout(timeout)
        reject(new Error("Records service stopped. No fallback database was opened."))
      })
      child.stdout.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-4096)
        const match = /Project records writer listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
        if (match) {
          clearTimeout(timeout)
          accept(match[1])
        }
      })
    })
    const token = (await readFile(desktopTokenFile, "utf8")).trim()
    const response = await fetch(`${endpoint}/v1/storage`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error("Records storage readiness check failed.")
    const storage = (await response.json()) as { backend?: string }
    if (storage.backend !== "sqlite") throw new Error("Standalone Records did not open SQLite.")
    // Owner credentials stay in main-process memory, never inherited by agent children.
    managedConnections.set(env, { endpoint, tokenFile: desktopTokenFile })
    return stop
  } catch (error) {
    stop()
    throw error
  }
}
