// @vitest-environment jsdom
import React, { act } from "react"
import { Chat, useChat } from "@ai-sdk/react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { hydrateChatFromPersistedMessages } from "../src/renderer/features/agents/main/chat-message-hydration"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("updates a subscribed chat view when the saved answer replaces an empty cached placeholder", async () => {
  const chat = new Chat({
    id: "cached-chat",
    messages: [{ id: "answer", role: "assistant", parts: [] }],
  })
  function View() {
    const { messages } = useChat({ chat })
    return (
      <div>
        {messages
          .flatMap((message) =>
            message.parts.map((part) => (part.type === "text" ? part.text : "")),
          )
          .join("")}
      </div>
    )
  }
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () => root.render(<View />))
    expect(container.textContent).toBe("")
    await act(async () => {
      expect(
        hydrateChatFromPersistedMessages(chat, [
          {
            id: "answer",
            role: "assistant",
            parts: [{ type: "text", text: "Restored without sending another prompt" }],
          },
        ]),
      ).toBe(true)
    })
    expect(container.textContent).toBe("Restored without sending another prompt")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
