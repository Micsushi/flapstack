// Stage 2 Track B — U7: Cursor usage provider.
//
// Tries a fallback chain: source #1 internal endpoints (implemented path,
// local-token auth), then #2 Admin API (stub), then #3 cursor-agent CLI (stub).
// Records the source tag (`internal` | `admin` | `cli`) on samples. Honest
// states: not installed, not logged in, auth failed, source unavailable.

import {
  type ProviderStatus,
  type UsageProvider,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../../types"
import { probeAdminSource, pollAdminSource } from "./source-admin"
import { probeCliSource, pollCliSource } from "./source-cli"
import { probeInternalSource, pollInternalSource, type CursorSourceResult } from "./source-internal"

export { detectCursorCredentials, detectCursorToken, cursorStateDbCandidates } from "./token"
export type { CursorCredentialsResult, CursorTokenResult } from "./token"

interface CursorSource {
  tag: "internal" | "admin" | "cli"
  probe: () => CursorSourceResult
  poll: (ctx: UsageProviderContext) => Promise<UsageSampleInput[]>
}

const SOURCES: CursorSource[] = [
  { tag: "internal", probe: probeInternalSource, poll: pollInternalSource },
  { tag: "admin", probe: probeAdminSource, poll: pollAdminSource },
  { tag: "cli", probe: probeCliSource, poll: pollCliSource },
]

/** First source whose probe reports it can run. */
function selectActiveSource(): { source: CursorSource; probe: CursorSourceResult } | null {
  for (const source of SOURCES) {
    const probe = source.probe()
    if (probe.available) return { source, probe }
  }
  return null
}

export function createCursorProvider(): UsageProvider {
  return {
    id: "cursor",
    label: "Cursor",
    billingKind: "subscription-quota",

    async isConfigured() {
      // Configured = at least one source probes available (local login present).
      return selectActiveSource() != null
    },

    async getStatus(): Promise<ProviderStatus> {
      const active = selectActiveSource()
      if (active) {
        return {
          providerId: "cursor",
          // The active source is provenance, not an account identity. Keep it
          // in sourceTag on samples until Cursor exposes a stable account key.
          status: active.probe.status === "ok" ? "ok" : "source-unavailable",
          detail: active.probe.detail,
          configured: true,
          supportsDaemon: true,
          supportsHistorical: false,
        }
      }
      // Report the most informative probe (internal source drives login state).
      const internal = probeInternalSource()
      return {
        providerId: "cursor",
        status:
          internal.status === "not-installed"
            ? "not-installed"
            : internal.status === "not-logged-in"
              ? "not-logged-in"
              : "source-unavailable",
        detail: internal.detail,
        configured: false,
        supportsDaemon: true,
        supportsHistorical: false,
      }
    },

    async pollLatest(ctx): Promise<UsageSampleInput[]> {
      const active = selectActiveSource()
      if (!active) return []
      const samples = await active.source.poll(ctx)
      return samples.map((s) => ({ ...s, sourceTag: active.source.tag }))
    },

    async reconcileSince(ctx): Promise<UsageSampleInput[]> {
      // Cursor exposes only current aggregate; reconcile == poll latest.
      return this.pollLatest(ctx)
    },

    supportsDaemon: () => true,
    supportsHistorical: () => false,
  }
}
