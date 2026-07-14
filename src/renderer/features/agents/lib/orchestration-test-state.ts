export type RendererOrchestrationCardState = {
  taskId: string
  chatId: string
  accessibleName: string
  status: string
  costQuality: string
  text: string
  controlLabels: string[]
  enabledControlLabels: string[]
  lineageLabels: string[]
  agentStatuses: Array<{ agentId: string; status: string }>
}

function boundedText(value: string | null | undefined, max = 8_000): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

/** Reads only bounded, user-visible orchestration semantics from the rendered task card. */
export function readRendererOrchestrationCard(
  root: ParentNode,
  taskId: string,
  chatId: string,
): RendererOrchestrationCardState | null {
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-orchestration-task-id]"))
  const card = cards.find(
    (candidate) =>
      candidate.dataset.orchestrationTaskId === taskId &&
      candidate.dataset.orchestrationChatId === chatId &&
      isSemanticallyVisible(candidate),
  )
  if (!card) return null

  const controls = Array.from(card.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
  return {
    taskId: card.dataset.orchestrationTaskId ?? "",
    chatId: card.dataset.orchestrationChatId ?? "",
    accessibleName: card.getAttribute("aria-label") ?? "",
    status: card.dataset.orchestrationStatus ?? "",
    costQuality: card.dataset.orchestrationCostQuality ?? "unknown",
    text: boundedText(card.textContent),
    controlLabels: controls.map((control) => boundedText(control.getAttribute("aria-label"), 300)),
    enabledControlLabels: controls
      .filter((control) => !control.disabled)
      .map((control) => boundedText(control.getAttribute("aria-label"), 300)),
    lineageLabels: controls
      .map((control) => boundedText(control.getAttribute("aria-label"), 300))
      .filter((label) => /^Open (?:parent agent|child agent|agent) chat/.test(label)),
    agentStatuses: Array.from(
      card.querySelectorAll<HTMLElement>("[data-orchestration-agent-id]"),
    ).map((agent) => ({
      agentId: agent.dataset.orchestrationAgentId ?? "",
      status: agent.dataset.orchestrationAgentStatus ?? "",
    })),
  }
}

function isSemanticallyVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      current.classList.contains("hidden") ||
      current.style.display === "none" ||
      current.style.visibility === "hidden"
    ) {
      return false
    }
    current = current.parentElement
  }
  return true
}
