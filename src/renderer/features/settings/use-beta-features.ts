import { DEFAULT_BETA_FEATURE_SETTINGS } from "../../../shared/beta-features"
import { trpc } from "../../lib/trpc"

export function useBetaFeatures() {
  const query = trpc.betaFeatures.get.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  })
  return query.data ?? DEFAULT_BETA_FEATURE_SETTINGS
}
