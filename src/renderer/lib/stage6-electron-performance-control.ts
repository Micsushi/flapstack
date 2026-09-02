import {
  getStage6ElectronMeasurementContract,
  type Stage6ElectronMeasurementAction,
  type Stage6ElectronMeasurementOperation,
} from "../../shared/stage6-electron-performance-control"

type MeasurementSession = {
  startedAt: number
  completedAt: number | null
  durationMs: number | null
}

const sessions = new Map<string, MeasurementSession>()

export async function controlStage6ElectronMeasurement(input: {
  budgetId: string
  action: Stage6ElectronMeasurementAction
  operation: Stage6ElectronMeasurementOperation
}) {
  const contract = getStage6ElectronMeasurementContract(input.budgetId)
  if (input.action !== contract.action) {
    throw new Error("Stage 6 Electron performance action does not match its budget.")
  }
  if (input.operation === "reset") {
    clearContractEntries(contract)
    sessions.delete(contract.budgetId)
    return state(contract, null)
  }
  if (input.operation === "begin") {
    clearContractEntries(contract)
    performance.mark(contract.startMarker)
    const session = {
      startedAt: performance.getEntriesByName(contract.startMarker, "mark")[0]!.startTime,
      completedAt: null,
      durationMs: null,
    }
    sessions.set(contract.budgetId, session)
    return state(contract, session)
  }
  if (input.operation === "sample") {
    clearContractEntries(contract)
    performance.mark(contract.startMarker)
    const startedAt = performance.getEntriesByName(contract.startMarker, "mark")[0]!.startTime
    const observedDuration = await observeContractAction(contract.action)
    performance.mark(contract.endMarker)
    performance.measure(contract.measureName, contract.startMarker, contract.endMarker)
    const session = {
      startedAt,
      completedAt: performance.now(),
      durationMs: observedDuration,
    }
    sessions.set(contract.budgetId, session)
    return state(contract, session)
  }
  const session = sessions.get(contract.budgetId)
  if (!session) {
    if (input.operation === "finish") {
      throw new Error("Stage 6 Electron performance measurement has not begun.")
    }
    return state(contract, null)
  }
  if (input.operation === "finish" && session.completedAt === null) {
    performance.mark(contract.endMarker)
    const measure = performance.measure(
      contract.measureName,
      contract.startMarker,
      contract.endMarker,
    )
    session.completedAt = measure.startTime + measure.duration
    session.durationMs = measure.duration
  }
  return state(contract, session)
}

async function observeContractAction(action: Stage6ElectronMeasurementAction): Promise<number> {
  if (action === "observe-cold-shell-ready" || action === "observe-warm-shell-ready") {
    throw new Error(
      "Electron shell readiness requires an external process orchestrator that owns restart and readiness.",
    )
  }
  if (action === "observe-animation-frames") return observeAnimationFrameStall(requireComposer())
  if (action === "observe-long-tasks") return observeLongTaskStall()

  const startedAt = performance.now()
  if (action === "open-first-use" || action === "open-warm-first-use") {
    await observeFirstUsePaint()
  } else if (action === "dispatch-input-probe") {
    await observeInputPaint(requireComposer())
  } else if (action === "dispatch-grid-input-probe") {
    await observeGridInputPaint()
  } else if (action === "render-long-chat-fixture") {
    await observeLongChatRender()
  } else if (action === "search-large-fixture") {
    await observeLargeSearch()
  }
  return performance.now() - startedAt
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolveReady) => requestAnimationFrame(resolveReady))
}

async function observeFirstUsePaint(): Promise<void> {
  const workbench = requireVisibleElement<HTMLElement>("[data-chat-workbench]", "chat workbench")
  requireVisibleElement<HTMLElement>("[data-chat-container]", "active chat transcript")
  const editor = requireComposer()
  workbench.focus({ preventScroll: true })
  editor.focus({ preventScroll: true })
  await nextAnimationFrame()
  await nextAnimationFrame()
}

async function observeInputPaint(editor: HTMLElement): Promise<void> {
  const restore = mutateComposer(editor)
  try {
    await nextAnimationFrame()
  } finally {
    restore()
  }
}

function mutateComposer(editor: HTMLElement): () => void {
  const previous = editor.innerHTML
  editor.focus({ preventScroll: true })
  editor.textContent = `${editor.textContent ?? ""}s`
  editor.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: "s", inputType: "insertText" }),
  )
  return () => {
    editor.innerHTML = previous
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: null,
        inputType: "insertReplacementText",
      }),
    )
  }
}

async function observeGridInputPaint(): Promise<void> {
  await ensureFourPaneProductGrid()
  const groups = visibleElements<HTMLElement>("[data-chat-workbench] [data-chat-group]")
  if (groups.length < 4) {
    throw new Error("Electron grid input measurement requires four visible product chat panes.")
  }
  const editors = groups
    .map((group) => group.querySelector<HTMLElement>('[contenteditable="true"]'))
    .filter((editor): editor is HTMLElement => Boolean(editor && isVisible(editor)))
  if (editors.length < 4) {
    throw new Error("Electron grid input measurement requires four visible product composers.")
  }
  await observeInputPaint(editors[3]!)
}

async function ensureFourPaneProductGrid(): Promise<void> {
  if (visibleElements<HTMLElement>("[data-chat-workbench] [data-chat-group]").length >= 4) return
  await new Promise<void>((resolveReady, rejectReady) => {
    const timeout = window.setTimeout(
      () => rejectReady(new Error("Electron grid setup timed out waiting for four product panes.")),
      5_000,
    )
    window.dispatchEvent(
      new CustomEvent("stage6-performance:configure-grid", {
        detail: {
          complete: (result: { expectedChatIds: string[]; visibleChatIds: string[] }) => {
            window.clearTimeout(timeout)
            const expected = new Set(result.expectedChatIds)
            const visible = new Set(result.visibleChatIds)
            if (
              expected.size !== 4 ||
              visible.size !== 4 ||
              [...expected].some((chatId) => !visible.has(chatId))
            ) {
              rejectReady(
                new Error("Electron grid setup did not render the four exact selected chats."),
              )
              return
            }
            resolveReady()
          },
          fail: (message: string) => {
            window.clearTimeout(timeout)
            rejectReady(new Error(message))
          },
        },
      }),
    )
  })
}

async function observeAnimationFrameStall(editor: HTMLElement): Promise<number> {
  const gaps: number[] = []
  let previous = await nextAnimationFrame()
  for (let frame = 0; frame < 20; frame += 1) {
    const restore = mutateComposer(editor)
    try {
      const current = await nextAnimationFrame()
      gaps.push(Math.max(0, current - previous - 1000 / 60))
      previous = current
    } finally {
      restore()
    }
  }
  return percentile(gaps, 0.95)
}

async function observeLongTaskStall(): Promise<number> {
  const durations: number[] = []
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes.includes("longtask")
  ) {
    throw new Error("Electron long-task performance observer is unavailable.")
  }
  const editor = requireComposer()
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) durations.push(entry.duration)
  })
  observer.observe({ type: "longtask", buffered: false })
  try {
    for (let index = 0; index < 10; index += 1) await observeInputPaint(editor)
    await nextAnimationFrame()
  } finally {
    observer.disconnect()
  }
  return durations.length > 0 ? percentile(durations, 0.95) : 0
}

async function observeLongChatRender(): Promise<void> {
  const viewport = requireLargeFixtureTranscript()
  const previousScrollTop = viewport.scrollTop
  try {
    viewport.scrollTop = 0
    await nextAnimationFrame()
    viewport.scrollTop = viewport.scrollHeight
    await nextAnimationFrame()
  } finally {
    viewport.scrollTop = previousScrollTop
  }
}

async function observeLargeSearch(): Promise<void> {
  const viewport = requireLargeFixtureTranscript()
  const previousScrollTop = viewport.scrollTop
  const isMac = window.desktopApi?.platform === "darwin"
  viewport.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "f",
      code: "KeyF",
      metaKey: isMac,
      ctrlKey: !isMac,
    }),
  )
  await nextAnimationFrame()
  const search = requireVisibleElement<HTMLInputElement>(
    "[data-chat-search-input]",
    "product chat search input",
  )
  const previous = search.value
  const query = `stage6-${performance.now().toFixed(3)}`
  try {
    search.focus({ preventScroll: true })
    setControlledInputValue(search, query)
    search.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: query, inputType: "insertText" }),
    )
    await waitForSearchCompletion(search, query)
  } finally {
    setControlledInputValue(search, previous)
    search.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: null,
        inputType: "insertReplacementText",
      }),
    )
    viewport.scrollTop = previousScrollTop
  }
}

function setControlledInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter)
    throw new Error("Electron search measurement cannot update the product search input.")
  setter.call(input, value)
}

async function waitForSearchCompletion(input: HTMLInputElement, query: string): Promise<void> {
  const search = input.closest<HTMLElement>("[data-chat-search]")
  if (!search) throw new Error("Electron search measurement requires the product search surface.")
  if (search.dataset.chatSearchCompletedQuery === query) return
  await new Promise<void>((resolveReady, rejectReady) => {
    const observer = new MutationObserver(() => {
      if (search.dataset.chatSearchCompletedQuery !== query) return
      window.clearTimeout(timeout)
      observer.disconnect()
      resolveReady()
    })
    const timeout = window.setTimeout(() => {
      observer.disconnect()
      rejectReady(
        new Error("Electron search measurement timed out waiting for product search completion."),
      )
    }, 5_000)
    observer.observe(search, {
      attributes: true,
      attributeFilter: ["data-chat-search-completed-query"],
    })
  })
}

function requireComposer(): HTMLElement {
  return requireVisibleElement<HTMLElement>(
    '[data-chat-workbench] [contenteditable="true"]',
    "product chat composer",
  )
}

function requireLargeFixtureTranscript(): HTMLElement {
  const transcript = requireVisibleElement<HTMLElement>(
    "[data-chat-container][data-stage6-performance-message-count]",
    "authoritative large chat transcript",
  )
  const count = Number(transcript.dataset.stage6PerformanceMessageCount)
  if (!Number.isInteger(count) || count < 200) {
    throw new Error(
      "Electron large-fixture measurement requires an actual product transcript with at least 200 messages.",
    )
  }
  return transcript
}

function requireVisibleElement<T extends HTMLElement>(selector: string, label: string): T {
  const element = visibleElements<T>(selector)[0]
  if (!element) throw new Error(`Electron performance requires a visible ${label}.`)
  return element
}

function visibleElements<T extends HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector)).filter(isVisible)
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  return (
    element.isConnected &&
    !element.hidden &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  )
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

function clearContractEntries(contract: {
  startMarker: string
  endMarker: string
  measureName: string
}): void {
  performance.clearMarks(contract.startMarker)
  performance.clearMarks(contract.endMarker)
  performance.clearMeasures(contract.measureName)
}

function state(
  contract: ReturnType<typeof getStage6ElectronMeasurementContract>,
  session: MeasurementSession | null,
) {
  return {
    contract,
    measurementKind: "observer-interval" as const,
    budgetEvaluated: false as const,
    status: session
      ? session.completedAt === null
        ? ("running" as const)
        : ("complete" as const)
      : ("idle" as const),
    startedAt: session?.startedAt ?? null,
    completedAt: session?.completedAt ?? null,
    durationMs: session?.durationMs ?? null,
  }
}
