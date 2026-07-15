import type {
  ProviderStatus,
  UsageProvider,
  UsageProviderContext,
  UsageSampleInput,
} from "../types"

/** Local usage is emitted by completed Ollama runs. It has no account-wide,
 * daemon-polled source and never requires a cloud credential. */
export function createLocalUsageProvider(): UsageProvider {
  return {
    id: "local",
    label: "Local / Ollama",
    billingKind: "api-spend",
    async isConfigured() {
      return true
    },
    async getStatus(): Promise<ProviderStatus> {
      return {
        providerId: "local",
        status: "run-usage-only",
        detail:
          "Local token usage is recorded from Ollama run responses. Compute, energy, and hardware use are not measured.",
        configured: true,
        supportsDaemon: false,
        supportsHistorical: false,
      }
    },
    async pollLatest(_ctx: UsageProviderContext): Promise<UsageSampleInput[]> {
      return []
    },
    async reconcileSince(
      _ctx: UsageProviderContext,
      _since: Date | null,
    ): Promise<UsageSampleInput[]> {
      return []
    },
    supportsDaemon: () => false,
    supportsHistorical: () => false,
  }
}
