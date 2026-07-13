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

  target.scrollIntoView({ block: "center", behavior: "smooth" })
  const focusTarget = target.matches(FOCUSABLE_SETTINGS_TARGET)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE_SETTINGS_TARGET)
  ;(focusTarget ?? target).focus({ preventScroll: true })
  target.animate(
    [
      { boxShadow: "0 0 0 0 rgba(245, 158, 11, 0)" },
      { boxShadow: "0 0 0 2px rgba(245, 158, 11, 0.65)" },
      { boxShadow: "0 0 0 0 rgba(245, 158, 11, 0)" },
    ],
    { duration: 1200, easing: "ease-out" },
  )
  return true
}
