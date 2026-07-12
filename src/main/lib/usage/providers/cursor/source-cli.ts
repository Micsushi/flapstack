// Stage 2 Track B - U7: Cursor usage source #3 (`cursor-agent` CLI) - stubbed.
//
// Least reliable source: parse whatever `cursor-agent` surfaces. It calls
// source #1 under the hood anyway, so this is a last resort. Reserved slot only.

import {
  UsageNotImplementedError,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../../types"
import type { CursorSourceResult } from "./source-internal"

export function probeCliSource(): CursorSourceResult {
  return {
    available: false,
    status: "source-unavailable",
    detail:
      "cursor-agent CLI usage output is a reserved last-resort slot; unimplemented this stage.",
    samples: [],
  }
}

export async function pollCliSource(_ctx: UsageProviderContext): Promise<UsageSampleInput[]> {
  throw new UsageNotImplementedError("cursor", "source-cli.poll")
}
