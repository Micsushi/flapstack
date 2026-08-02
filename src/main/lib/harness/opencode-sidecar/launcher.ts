/**
 * OpenCode sidecar launcher + lifecycle (Track E - E2).
 *
 * Spawns `opencode serve --hostname 127.0.0.1 --port 0`, captures the printed
 * base URL, and owns process teardown (kill the process group on cancel/end).
 * stdout/stderr are kept as a bounded ring buffer with provider keys redacted.
 *
 * Spawn + URL capture + teardown are driven by persisted OpenRouter and
 * NanoGPT runs. Runtime can be disabled explicitly for diagnosis.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { resolveOpencodeBinary, serveArgs } from "./binary"
import { generateServerPassword } from "./client"
import { writeIsolatedConfig } from "./config"
import { limitation, type SidecarLimitation } from "./contract"
import type { OpencodeProviderId } from "./contract"
import { startOpenRouterGenerationProxy, type GenerationProxyHandle } from "./generation-proxy"
import type { McpStdioRegistration } from "../../mcp-control/registration"

const MAX_LOG_LINES = 200
const BASE_URL_REGEX = /https?:\/\/127\.0\.0\.1:\d+/

export type SidecarHandle = {
  baseUrl: string
  password: string
  directory: string
  configDir: string
  process: ChildProcess
  /** Bounded, key-redacted recent output for debugging. */
  readLog(): string
  takeGenerationId(): string | undefined
  stop(): void
}

export type SidecarStartResult =
  { ok: true; handle: SidecarHandle } | { ok: false; limitation: SidecarLimitation }

function redact(line: string, secrets: string[]): string {
  let out = line
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("***")
  }
  return out
}

const SIDE_CAR_ENV_SECRET = /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION)/i

/** Keep unrelated app/provider credentials out of the model-controlled sidecar. */
export function sanitizeSidecarParentEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name === "SSH_AUTH_SOCK" || !SIDE_CAR_ENV_SECRET.test(name),
    ),
  )
}

/**
 * Start the sidecar for a provider run. Resolves when the base URL has been
 * observed on stdout or the startup times out.
 */
export async function startSidecar(params: {
  provider: OpencodeProviderId
  /** Native model id to declare in the isolated custom-provider config. */
  modelId?: string
  reasoningEnabled: boolean
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh"
  reasoningSupported: boolean | null
  cwd: string
  startupTimeoutMs?: number
  signal?: AbortSignal
  productMcp?: McpStdioRegistration
}): Promise<SidecarStartResult> {
  const resolution = resolveOpencodeBinary()
  if (resolution.kind === "missing") {
    return {
      ok: false,
      limitation: limitation("opencode-missing", resolution.reason, "Install Node.js and retry."),
    }
  }

  let configDir: string
  let configEnv: Record<string, string>
  let generationProxy: GenerationProxyHandle | null = null
  try {
    if (params.provider === "openrouter") generationProxy = await startOpenRouterGenerationProxy()
    const generated = writeIsolatedConfig(
      params.provider,
      params.modelId,
      generationProxy?.baseUrl,
      params.reasoningEnabled,
      params.reasoningEffort,
      params.reasoningSupported,
      params.productMcp,
    )
    configDir = generated.configDir
    configEnv = generated.env
  } catch (error) {
    generationProxy?.close()
    return {
      ok: false,
      limitation: limitation(
        error instanceof Error && error.message.includes("API key")
          ? "provider-key-missing"
          : "config-write-failed",
        error instanceof Error ? error.message : String(error),
        "Add the provider API key in Settings, then retry.",
      ),
    }
  }

  const password = generateServerPassword()
  const secrets = [
    ...Object.entries(configEnv).flatMap(([name, value]) =>
      SIDE_CAR_ENV_SECRET.test(name) ? [value] : [],
    ),
    password,
  ]
  const logLines: string[] = []
  const pushLog = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line) continue
      logLines.push(redact(line, secrets))
      if (logLines.length > MAX_LOG_LINES) logLines.shift()
    }
  }

  const child = spawn(resolution.command, [...resolution.args, ...serveArgs()], {
    cwd: params.cwd,
    env: {
      ...sanitizeSidecarParentEnvironment(process.env),
      ...configEnv,
      OPENCODE_SERVER_PASSWORD: password,
      // Do not let a project checkout override this run's provider or rules.
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })

  const handle: SidecarHandle = {
    baseUrl: "",
    password,
    directory: params.cwd,
    configDir,
    process: child,
    readLog: () => logLines.join("\n"),
    takeGenerationId: () => generationProxy?.takeGenerationId(),
    stop: () => {
      generationProxy?.close()
      stopSidecar(child, configDir)
    },
  }

  const startupTimeoutMs = params.startupTimeoutMs ?? 20_000

  return new Promise<SidecarStartResult>((resolve) => {
    let settled = false
    const finish = (result: SidecarStartResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) {
        generationProxy?.close()
        stopSidecar(child, configDir)
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        limitation: limitation(
          "server-startup-timeout",
          `Provider runtime did not start within ${startupTimeoutMs}ms.`,
          "Retry; if it persists, check the provider runtime logs.",
        ),
      })
    }, startupTimeoutMs)

    let startupOutput = ""
    const scanForUrl = (chunk: Buffer) => {
      startupOutput = (startupOutput + chunk.toString("utf8")).slice(-4096)
      const match = startupOutput.match(BASE_URL_REGEX)
      if (match && !handle.baseUrl) {
        handle.baseUrl = match[0]
        finish({ ok: true, handle })
      }
    }

    child.stdout?.on("data", (c: Buffer) => {
      pushLog(c)
      scanForUrl(c)
    })
    child.stderr?.on("data", (c: Buffer) => {
      pushLog(c)
      scanForUrl(c)
    })
    child.on("error", (err) => {
      finish({
        ok: false,
        limitation: limitation(
          "opencode-missing",
          `Failed to start the provider runtime: ${err.message}`,
          "Verify the Node.js install.",
        ),
      })
    })
    child.on("exit", (code) => {
      finish({
        ok: false,
        limitation: limitation(
          "server-startup-timeout",
          `Provider runtime exited before startup (code ${code ?? "null"}).`,
          "Check provider credentials and the provider runtime logs.",
        ),
      })
    })

    params.signal?.addEventListener("abort", () => {
      finish({
        ok: false,
        limitation: limitation("server-startup-timeout", "Startup aborted.", "Retry the run."),
      })
    })
  })
}

/** Kill the sidecar process group (best effort, cross-platform). */
export function stopSidecar(child: ChildProcess, configDir?: string): void {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === "win32") {
        child.kill()
      } else if (child.pid) {
        // Negative pid targets the whole process group (detached spawn).
        process.kill(-child.pid, "SIGTERM")
      }
    } catch {
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    }
  }
  if (configDir) {
    try {
      rmSync(configDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup of generated, non-secret config.
    }
  }
}
