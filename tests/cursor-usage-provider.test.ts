import { describe, expect, it, vi } from "vitest"

vi.mock("../src/main/lib/usage/providers/cursor/source-internal", () => ({
  probeInternalSource: () => ({
    available: true,
    status: "ok",
    detail: "internal source",
    samples: [],
  }),
  pollInternalSource: async (ctx: { source: string }) => [
    {
      providerId: "cursor",
      source: ctx.source,
      sourceTag: "internal",
      costQuality: "provider-reported",
      quotaUsed: 5,
      quotaLimit: 20,
    },
  ],
}))

vi.mock("../src/main/lib/usage/providers/cursor/source-admin", () => ({
  probeAdminSource: () => ({ available: false, status: "source-unavailable", samples: [] }),
  pollAdminSource: async () => [],
}))

vi.mock("../src/main/lib/usage/providers/cursor/source-cli", () => ({
  probeCliSource: () => ({ available: false, status: "source-unavailable", samples: [] }),
  pollCliSource: async () => [],
}))

import { createCursorProvider } from "../src/main/lib/usage/providers/cursor"

describe("Cursor usage account grouping", () => {
  it("keeps source provenance out of the account key", async () => {
    const provider = createCursorProvider()
    const context = {
      now: new Date("2026-07-10T00:00:00Z"),
      source: "app-poll" as const,
      getSecret: async () => null,
      log: () => {},
    }

    const status = await provider.getStatus(context)
    const [sample] = await provider.pollLatest(context)

    expect(status.accountTag).toBeUndefined()
    expect(sample?.accountTag).toBeUndefined()
    expect(sample?.sourceTag).toBe("internal")
  })
})
