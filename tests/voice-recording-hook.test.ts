// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVoiceRecording } from "../src/renderer/lib/hooks/use-voice-recording"

type VoiceControls = ReturnType<typeof useVoiceRecording>

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported() {
    return true
  }

  state: RecordingState = "inactive"
  mimeType: string
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(
    readonly stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm"
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = "recording"
  }

  stop() {
    this.state = "inactive"
    queueMicrotask(() => this.onstop?.(new Event("stop")))
  }
}

describe("voice recording startup lifecycle", () => {
  let root: Root
  let container: HTMLDivElement
  let controls: VoiceControls | null
  let resolveStream: (stream: MediaStream) => void
  let trackStop: ReturnType<typeof vi.fn>
  let stream: MediaStream

  function Harness(): ReactNode {
    controls = useVoiceRecording()
    return null
  }

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    FakeMediaRecorder.instances = []
    controls = null
    trackStop = vi.fn()
    stream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve
        }),
    )
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    vi.spyOn(console, "warn").mockImplementation(() => {})

    container = document.createElement("div")
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("waits for a pending microphone start when release requests stop", async () => {
    let startPromise!: Promise<void>
    await act(async () => {
      startPromise = controls!.startRecording()
    })
    const stopPromise = controls!.stopRecording()

    let blob: Blob | undefined
    await act(async () => {
      resolveStream(stream)
      await startPromise
      blob = await stopPromise
    })

    expect(blob).toBeInstanceOf(Blob)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0]?.state).toBe("inactive")
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(controls?.isRecording).toBe(false)
  })

  it("stops a late stream when startup is cancelled", async () => {
    let startPromise!: Promise<void>
    await act(async () => {
      startPromise = controls!.startRecording()
      controls!.cancelRecording()
    })

    await act(async () => {
      resolveStream(stream)
      await startPromise
    })

    expect(FakeMediaRecorder.instances).toHaveLength(0)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(controls?.isRecording).toBe(false)
  })
})
