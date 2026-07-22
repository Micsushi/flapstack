import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function detectFileSymlinkSupport(): boolean {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-file-symlink-probe-"))
  try {
    const target = join(directory, "target.txt")
    writeFileSync(target, "probe")
    symlinkSync(target, join(directory, "link.txt"), "file")
    return true
  } catch {
    return false
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export const fileSymlinksSupported = detectFileSymlinkSupport()

export function requireFileSymlinkCoverage(
  supported: boolean,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!supported && env.FLAPSTACK_REQUIRE_FILE_SYMLINK_TESTS === "1") {
    throw new Error(
      "File symlink security tests cannot run. Enable Windows Developer Mode or grant SeCreateSymbolicLinkPrivilege.",
    )
  }
}

requireFileSymlinkCoverage(fileSymlinksSupported)
