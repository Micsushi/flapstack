import { useEffect, useState } from "react"

const NARROW_SETTINGS_BREAKPOINT = 768

export function useIsNarrowScreen(): boolean {
  const matches = () =>
    typeof window !== "undefined" && window.innerWidth <= NARROW_SETTINGS_BREAKPOINT
  const [isNarrow, setIsNarrow] = useState(matches)

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${NARROW_SETTINGS_BREAKPOINT}px)`)
    const update = () => setIsNarrow(media.matches)
    media.addEventListener("change", update)
    update()
    return () => media.removeEventListener("change", update)
  }, [])

  return isNarrow
}
