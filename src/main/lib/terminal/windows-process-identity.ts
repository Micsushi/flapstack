import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface WindowsProcessIdentity {
  processId: number
  ownershipToken: string
  executableName: string
}

export async function terminateMatchingWindowsProcesses(
  identities: readonly WindowsProcessIdentity[],
): Promise<number[]> {
  if (process.platform !== "win32" || identities.length === 0) return []
  const encoded = Buffer.from(JSON.stringify(identities), "utf8").toString("base64")
  const script = [
    `$items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json`,
    "$killed = foreach ($identity in @($items)) {",
    "  try {",
    "    $process = Get-Process -Id ([int]$identity.processId) -ErrorAction Stop",
    "    $null = $process.Handle",
    "    $processStartTicks = $process.StartTime.ToUniversalTime().Ticks",
    '    $details = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$identity.processId) -ErrorAction Stop',
    "    $detailsStartTicks = ([datetime]$details.CreationDate).ToUniversalTime().Ticks",
    "    $sameStart = [Math]::Abs([long]($processStartTicks - $detailsStartTicks)) -lt [TimeSpan]::TicksPerMillisecond",
    "    $sameToken = ([string]$details.CommandLine).Contains([string]$identity.ownershipToken)",
    "    $actualExecutable = [IO.Path]::GetFileName([string]$details.ExecutablePath)",
    "    $sameExecutable = $actualExecutable.ToLowerInvariant() -eq ([string]$identity.executableName).ToLowerInvariant()",
    "    if ($sameStart -and $sameToken -and $sameExecutable) { $killedProcessId = $process.Id; $process.Kill(); $killedProcessId }",
    "  } catch {}",
    "}",
    "$killed | ConvertTo-Json -Compress",
  ].join("; ")
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 5_000, windowsHide: true },
  )
  return parseProcessIds(stdout)
}

function parseProcessIds(output: string): number[] {
  const value = output.replace(/^\uFEFF/, "").trim()
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  const processIds = Array.isArray(parsed) ? parsed.map(Number) : [Number(parsed)]
  return [...new Set(processIds)].filter(
    (processId) => Number.isSafeInteger(processId) && processId > 0,
  )
}
