import { useEffect } from "react"
import { trpc } from "../../lib/trpc"
import type { OptionalFeatureId } from "../../../shared/feature-visibility"

export function useFeatureVisibility() {
  const utils = trpc.useUtils()
  const query = trpc.featureVisibility.get.useQuery(
    { profileKind: "existing" },
    { staleTime: Number.POSITIVE_INFINITY },
  )

  useEffect(
    () =>
      window.desktopApi.onFeatureVisibilityChanged(() => {
        void utils.featureVisibility.get.invalidate()
      }),
    [utils.featureVisibility.get],
  )

  return {
    status: query.data?.status ?? "upgrade-preserved",
    isVisible: (featureId: OptionalFeatureId) => query.data?.visibility[featureId] ?? true,
  }
}
