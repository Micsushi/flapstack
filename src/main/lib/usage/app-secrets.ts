// App-side usage credential resolver. Direct usage/daemon credentials remain
// authoritative, but OpenRouter and NanoGPT can reuse the key already entered
// for their Flapstack chat provider.

import { getProviderKeyAsync } from "../harness/opencode-sidecar/credentials"
import { getUsageSecret } from "./secrets"

export async function getAppUsageSecret(key: string): Promise<string | null> {
  const usageSecret = getUsageSecret(key)
  if (usageSecret) return usageSecret
  if (key === "openrouter.api_key") return getProviderKeyAsync("openrouter")
  if (key === "nanogpt.api_key") return getProviderKeyAsync("nanogpt")
  return null
}
