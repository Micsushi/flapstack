export type TopNavigationDropIntent = "before" | "inside" | "after"

export function resolveTopNavigationDropIntent(
  clientX: number,
  left: number,
  width: number,
): TopNavigationDropIntent {
  if (width <= 0) return "inside"
  const position = (clientX - left) / width
  if (position <= 0.25) return "before"
  if (position >= 0.75) return "after"
  return "inside"
}

export function resolveTopNavigationReorderIntent(
  clientX: number,
  left: number,
  width: number,
): Exclude<TopNavigationDropIntent, "inside"> {
  return width > 0 && clientX - left >= width / 2 ? "after" : "before"
}
