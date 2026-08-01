const FOCUSABLE_SETTINGS_TARGET = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

export function revealSettingsTarget(searchTarget: string, root: ParentNode = document): boolean {
  const target = Array.from(root.querySelectorAll<HTMLElement>("[data-settings-id]")).find(
    (element) => element.dataset.settingsId === searchTarget,
  )
  if (!target) return false

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" })
  const focusTarget = target.matches(FOCUSABLE_SETTINGS_TARGET)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE_SETTINGS_TARGET)
  ;(focusTarget ?? target).focus({ preventScroll: true })
  if (!reduceMotion) {
    target.animate(
      [
        { boxShadow: "0 0 0 0 rgba(0, 52, 255, 0)" },
        { boxShadow: "0 0 0 2px rgba(0, 52, 255, 0.65)" },
        { boxShadow: "0 0 0 0 rgba(0, 52, 255, 0)" },
      ],
      { duration: 180, easing: "ease-out" },
    )
  }
  return true
}
