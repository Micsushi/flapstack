// Stage 2 Track B — U7: Cursor usage source #2 (Admin API) — stubbed slot.
//
// The public Cursor Admin API is team/admin only. It stays a stub unless
// implementation verifies it is useful for the user's account. This file
// reserves the fallback slot so the source chain has a clear extension point.

import {
  UsageNotImplementedError,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../../types"
import type { CursorSourceResult } from "./source-internal"

export function probeAdminSource(): CursorSourceResult {
  return {
    available: false,
    status: "source-unavailable",
    detail:
      "Cursor Admin API (team/admin only) is a reserved fallback slot; unimplemented this stage.",
    samples: [],
  }
}

export async function pollAdminSource(_ctx: UsageProviderContext): Promise<UsageSampleInput[]> {
  throw new UsageNotImplementedError("cursor", "source-admin.poll")
}
