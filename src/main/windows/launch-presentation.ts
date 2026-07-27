export type DisplayBounds = {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
}

export type LaunchPresentation = {
  showInactive: boolean
  startMinimized: boolean
  keepRendererActive?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

const DEFAULT_WIDTH = 1_400
const DEFAULT_HEIGHT = 900
const DEFAULT_PRESENTATION: LaunchPresentation = {
  showInactive: false,
  startMinimized: false,
}

export function createInitialLaunchPresentationResolver() {
  let consumed = false
  return (
    input: Parameters<typeof resolveLaunchPresentation>[0],
    useInitialPresentation: boolean,
  ): LaunchPresentation => {
    if (!useInitialPresentation || consumed) return { ...DEFAULT_PRESENTATION }
    consumed = true
    return resolveLaunchPresentation(input)
  }
}

export function resolveLaunchPresentation(input: {
  env: NodeJS.ProcessEnv
  argv: readonly string[]
  displays: readonly DisplayBounds[]
  primaryDisplayId: number | null
}): LaunchPresentation {
  const showInactive = input.env.FLAPSTACK_NO_FOCUS === "1" || input.argv.includes("--no-focus")
  const startMinimized =
    input.env.FLAPSTACK_START_MINIMIZED === "1" || input.argv.includes("--start-minimized")
  const useSecondaryDisplay =
    input.env.FLAPSTACK_WINDOW_DISPLAY === "secondary" || input.argv.includes("--secondary-display")
  const keepRendererActive = input.env.FLAPSTACK_KEEP_RENDERER_ACTIVE === "1"

  const secondaryDisplays = input.displays
    .filter((display) => display.id !== input.primaryDisplayId)
    .toSorted((left, right) => right.workArea.x - left.workArea.x)
  const targetDisplay = useSecondaryDisplay ? secondaryDisplays.at(0) : undefined

  return {
    showInactive: showInactive || startMinimized,
    startMinimized,
    ...(keepRendererActive ? { keepRendererActive: true } : {}),
    ...(targetDisplay ? { bounds: centeredBounds(targetDisplay.workArea) } : {}),
  }
}

function centeredBounds(workArea: DisplayBounds["workArea"]) {
  const width = Math.min(DEFAULT_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_HEIGHT, workArea.height)
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height,
  }
}
