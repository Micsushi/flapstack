import { describe, expect, it } from "vitest"
import {
  createInitialLaunchPresentationResolver,
  resolveLaunchPresentation,
} from "../src/main/windows/launch-presentation"

const displays = [
  {
    id: 1,
    bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
    workArea: { x: 0, y: 0, width: 1_920, height: 1_040 },
  },
  {
    id: 2,
    bounds: { x: 1_920, y: 0, width: 1_280, height: 1_024 },
    workArea: { x: 1_920, y: 0, width: 1_280, height: 984 },
  },
]

describe("background test window launch presentation", () => {
  it("starts inactive and actually minimized on the secondary display", () => {
    expect(
      resolveLaunchPresentation({
        env: {
          FLAPSTACK_NO_FOCUS: "1",
          FLAPSTACK_START_MINIMIZED: "1",
          FLAPSTACK_WINDOW_DISPLAY: "secondary",
        },
        argv: [],
        displays,
        primaryDisplayId: 1,
      }),
    ).toEqual({
      showInactive: true,
      startMinimized: true,
      bounds: { x: 1_920, y: 42, width: 1_280, height: 900 },
    })
  })

  it("does not invent a secondary-display position when only the primary exists", () => {
    expect(
      resolveLaunchPresentation({
        env: {
          FLAPSTACK_START_MINIMIZED: "1",
          FLAPSTACK_WINDOW_DISPLAY: "secondary",
        },
        argv: [],
        displays: [displays[0]!],
        primaryDisplayId: 1,
      }),
    ).toEqual({ showInactive: true, startMinimized: true })
  })

  it("chooses the right-hand display when secondary monitors exist on both sides", () => {
    const leftDisplay = {
      id: 3,
      bounds: { x: -1_280, y: 0, width: 1_280, height: 1_024 },
      workArea: { x: -1_280, y: 0, width: 1_280, height: 984 },
    }

    expect(
      resolveLaunchPresentation({
        env: { FLAPSTACK_WINDOW_DISPLAY: "secondary" },
        argv: [],
        displays: [leftDisplay, displays[0]!, displays[1]!],
        primaryDisplayId: 1,
      }).bounds,
    ).toEqual({ x: 1_920, y: 42, width: 1_280, height: 900 })
  })

  it("can keep the renderer responsive for minimized MCP acceptance", () => {
    expect(
      resolveLaunchPresentation({
        env: { FLAPSTACK_KEEP_RENDERER_ACTIVE: "1" },
        argv: [],
        displays,
        primaryDisplayId: 1,
      }),
    ).toEqual({
      showInactive: false,
      startMinimized: false,
      keepRendererActive: true,
    })
  })

  it("keeps normal launches unchanged", () => {
    expect(
      resolveLaunchPresentation({
        env: {},
        argv: [],
        displays,
        primaryDisplayId: 1,
      }),
    ).toEqual({ showInactive: false, startMinimized: false })
  })

  it("applies automation launch flags only to the first main window", () => {
    const resolveInitial = createInitialLaunchPresentationResolver()
    const input = {
      env: {
        FLAPSTACK_NO_FOCUS: "1",
        FLAPSTACK_START_MINIMIZED: "1",
        FLAPSTACK_WINDOW_DISPLAY: "secondary",
        FLAPSTACK_KEEP_RENDERER_ACTIVE: "1",
      },
      argv: [],
      displays,
      primaryDisplayId: 1,
    }
    expect(resolveInitial(input, true)).toMatchObject({
      showInactive: true,
      startMinimized: true,
      keepRendererActive: true,
      bounds: { x: 1_920 },
    })
    expect(resolveInitial(input, false)).toEqual({
      showInactive: false,
      startMinimized: false,
    })
    expect(resolveInitial(input, true)).toEqual({
      showInactive: false,
      startMinimized: false,
    })
  })
})
