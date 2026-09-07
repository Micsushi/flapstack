/** Resize only one adjacent pair, scaling impossible minima to the available space. */
export function resizeSplitPair(
  ratios: readonly number[],
  index: number,
  delta: number,
  minimumLeft: number,
  minimumRight: number,
): number[] | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index + 1 >= ratios.length ||
    !ratios.every((ratio) => Number.isFinite(ratio) && ratio > 0) ||
    !Number.isFinite(delta) ||
    !Number.isFinite(minimumLeft) ||
    !Number.isFinite(minimumRight) ||
    minimumLeft <= 0 ||
    minimumRight <= 0
  )
    return null
  const combined = ratios[index] + ratios[index + 1]
  const scale = Math.min(1, combined / (minimumLeft + minimumRight))
  const left = Math.min(
    combined - minimumRight * scale,
    Math.max(minimumLeft * scale, ratios[index] + delta),
  )
  if (!Number.isFinite(combined) || !(left > 0 && combined - left > 0)) return null
  const next = [...ratios]
  next[index] = left
  next[index + 1] = combined - left
  return next
}
