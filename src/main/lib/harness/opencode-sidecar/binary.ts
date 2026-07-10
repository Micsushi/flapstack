/**
 * OpenCode binary resolution (Track E — E2).
 *
 * Resolution strategy (documented update policy per E2): prefer an explicit
 * `FLAPSTACK_OPENCODE_BIN` override, then a resolvable `opencode` on PATH, then
 * fall back to `npx -y opencode-ai@<pinned>`. Pinning the npx version keeps
 * harness behavior reproducible.
 *
 * Scaffolding stage: PATH/override detection is real and testable; the pinned
 * version constant is the single place to bump the engine.
 */

import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

/** Pinned OpenCode version used when falling back to npx. Bump deliberately. */
export const PINNED_OPENCODE_VERSION = "1.17.18"

export type OpencodeBinaryResolution =
  | { kind: "explicit"; command: string; args: string[] }
  | { kind: "path"; command: string; args: string[] }
  | { kind: "npx"; command: string; args: string[] }
  | { kind: "missing"; reason: string }

function isExecutableOnPath(binName: string): string | null {
  const pathEnv = process.env.PATH
  if (!pathEnv) return null
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""]
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, binName + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve how to launch OpenCode. Returns the base command + args to which the
 * launcher appends `serve --hostname 127.0.0.1 --port 0`.
 */
export function resolveOpencodeBinary(): OpencodeBinaryResolution {
  const override = process.env.FLAPSTACK_OPENCODE_BIN?.trim()
  if (override) {
    if (existsSync(override)) {
      return { kind: "explicit", command: override, args: [] }
    }
    return {
      kind: "missing",
      reason: `FLAPSTACK_OPENCODE_BIN points to a non-existent path: ${override}`,
    }
  }

  const onPath = isExecutableOnPath("opencode")
  if (onPath) {
    return { kind: "path", command: onPath, args: [] }
  }

  const npx = isExecutableOnPath("npx")
  if (npx) {
    return {
      kind: "npx",
      command: npx,
      args: ["-y", `opencode-ai@${PINNED_OPENCODE_VERSION}`],
    }
  }

  return {
    kind: "missing",
    reason:
      "OpenCode is not installed and npx (Node.js) is not available. Install Node.js, or set FLAPSTACK_OPENCODE_BIN.",
  }
}

export function serveArgs(): string[] {
  return ["serve", "--hostname", "127.0.0.1", "--port", "0"]
}
