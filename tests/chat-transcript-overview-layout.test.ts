import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ChatTranscriptOverview } from "../src/renderer/features/agents/main/chat-transcript-overview"
import type { TranscriptMarker } from "../src/renderer/features/agents/main/chat-transcript-overview-model"

describe("ChatTranscriptOverview layout", () => {
  it("hides the timeline until a chat has more than three conversation turns", () => {
    expect(renderOverview(markers(3))).toBe("")
    expect(renderOverview(markers(4))).toContain('aria-label="Transcript timeline"')
  })

  it("packs visible timeline markers into a compact centered stack", () => {
    const html = renderOverview(markers(4))

    expect(html).toContain("h-4 w-7")
    expect(html).not.toContain("min-h-10")
    expect(html.match(/<li/g)).toHaveLength(4)
  })

  it("keeps markers visible and interactive without first hovering the rail", () => {
    const html = renderOverview(markers(4))

    expect(html).toContain("group/timeline")
    expect(html).toContain("hover:bg-popover")
    expect(html).toContain("focus-within:bg-popover")
    expect(html).not.toContain("opacity-0")
    expect(html).not.toContain("group-hover/timeline:opacity-100")
    expect(html).toContain('<ol class="relative flex max-h-full flex-col justify-center">')
  })
})

function renderOverview(items: TranscriptMarker[]) {
  return renderToStaticMarkup(
    createElement(ChatTranscriptOverview, {
      markers: items,
      onJump: vi.fn(),
    }),
  )
}

function markers(total: number): TranscriptMarker[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `prompt-${index + 1}`,
    ordinal: index + 1,
    total,
    promptPreview: `Prompt ${index + 1}`,
    responsePreview: `Response ${index + 1}`,
  }))
}
