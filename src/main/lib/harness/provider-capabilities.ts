import { runCursorCli, type CursorCliResult } from "../cursor/binary"
import { parseCursorModels } from "../cursor/integration"
import {
  PINNED_OPENCODE_VERSION,
  resolveOpencodeBinary,
  runOpencodeCli,
  type OpencodeCliResult,
} from "./opencode-sidecar/binary"

type ProbeResult = {
  ok: boolean
  exitCode: number | null
  output: string
  error?: string
}

export type ProviderCapabilitySnapshot = {
  provider: "cursor" | "opencode"
  capturedAt: string
  version: string | null
  binary: string | null
  probes: Record<string, ProbeResult>
  modelIds: string[]
  limitations: string[]
}

type CursorRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<CursorCliResult>
type OpencodeRunner = (
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<OpencodeCliResult>

export async function probeCursorCapabilities(
  run: CursorRunner = runCursorCli,
): Promise<ProviderCapabilitySnapshot> {
  const [version, help, status, models] = await Promise.all([
    probe(() => run(["--version"], { timeoutMs: 15_000 })),
    probe(() => run(["--help"], { timeoutMs: 15_000 })),
    probe(() => run(["status"], { timeoutMs: 15_000 })),
    probe(() => run(["models"], { timeoutMs: 15_000 })),
  ])
  const modelIds = models.ok ? parseCursorModels(models.output) : []
  return {
    provider: "cursor",
    capturedAt: new Date().toISOString(),
    version: version.ok ? firstVersionLine(version.output) : null,
    binary: "cursor-agent",
    probes: { version, help, status, models },
    modelIds,
    limitations: [
      ...(help.ok && /\bmcp\b/i.test(help.output)
        ? []
        : ["Current help did not advertise MCP management."]),
      ...(modelIds.length > 0 ? [] : ["No executable Cursor model IDs were discovered."]),
    ],
  }
}

export async function probeOpencodeCapabilities(
  run: OpencodeRunner = runOpencodeCli,
): Promise<ProviderCapabilitySnapshot> {
  const resolution = resolveOpencodeBinary()
  if (resolution.kind === "missing") {
    return {
      provider: "opencode",
      capturedAt: new Date().toISOString(),
      version: null,
      binary: null,
      probes: {},
      modelIds: [],
      limitations: [resolution.reason],
    }
  }
  const [version, help] = await Promise.all([
    probe(() => run(["--version"], { timeoutMs: 30_000 })),
    probe(() => run(["--help"], { timeoutMs: 30_000 })),
  ])
  return {
    provider: "opencode",
    capturedAt: new Date().toISOString(),
    version: version.ok ? firstVersionLine(version.output) : null,
    binary: `${resolution.kind}:${resolution.command}`,
    probes: { version, help },
    modelIds: [],
    limitations: [
      `OpenCode fallback is pinned to ${PINNED_OPENCODE_VERSION}.`,
      "OpenRouter and NanoGPT model IDs come from authenticated provider catalogs, not CLI help.",
    ],
  }
}

async function probe(
  operation: () => Promise<{ stdout: string; stderr: string; exitCode: number | null }>,
): Promise<ProbeResult> {
  try {
    const result = await operation()
    const output = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim())
      .join("\n")
      .trim()
      .slice(0, 200_000)
    return { ok: result.exitCode === 0, exitCode: result.exitCode, output }
  } catch (error) {
    return {
      ok: false,
      exitCode: null,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function firstVersionLine(output: string): string | null {
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  )
}
