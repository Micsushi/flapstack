// @vitest-environment jsdom

import fs from "node:fs"
import path from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "../src/renderer/components/ui/tooltip"
import {
  getSubChatDraft,
  loadGlobalDrafts,
  saveGlobalDrafts,
  updateNewChatDraftText,
  updateSubChatDraftText,
} from "../src/renderer/features/agents/lib/drafts"

vi.mock("../src/renderer/lib/hotkeys", () => ({
  useResolvedHotkeyDisplay: () => null,
  useResolvedHotkeyDisplayWithAlt: () => ({ primary: null, alt: null }),
}))

import {
  AgentSendButton,
  AgentVoiceButton,
} from "../src/renderer/features/agents/components/agent-send-button"

describe("separate dictation controls", () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("keeps pause and send as separate buttons while recording", () => {
    const start = vi.fn()
    const stop = vi.fn()
    const send = vi.fn()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        createElement(
          TooltipProvider,
          null,
          createElement(
            "div",
            null,
            createElement(AgentVoiceButton, {
              isRecording: true,
              isTranscribing: false,
              voiceInputReady: true,
              onStart: start,
              onStop: stop,
            }),
            createElement(AgentSendButton, {
              onClick: send,
              hasContent: true,
            }),
          ),
        ),
      )
    })

    const pause = container.querySelector('button[aria-label="Pause dictation"]')
    const sendButton = container.querySelector('button[aria-label="Send message"]')
    expect(pause).not.toBeNull()
    expect(sendButton).not.toBeNull()

    act(() => {
      pause!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(stop).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it("shows immediate starting feedback before microphone capture resolves", () => {
    const stop = vi.fn()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        createElement(
          TooltipProvider,
          null,
          createElement(AgentVoiceButton, {
            isRecording: false,
            isStarting: true,
            isTranscribing: false,
            voiceInputReady: true,
            onStart: vi.fn(),
            onStop: stop,
          }),
        ),
      )
    })

    const starting = container.querySelector('button[aria-label="Starting dictation"]')
    expect(starting).not.toBeNull()
    act(() => starting!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(stop).toHaveBeenCalledOnce()
  })
})

describe("background dictation send ownership", () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
  })

  it("captures the chat-bound send callback and finalized text before navigation", () => {
    const inputSource = fs.readFileSync(
      path.join(process.cwd(), "src/renderer/features/agents/main/chat-input-area.tsx"),
      "utf8",
    )
    const chatSource = fs.readFileSync(
      path.join(process.cwd(), "src/renderer/features/agents/main/active-chat.tsx"),
      "utf8",
    )

    expect(inputSource).toContain("const sendToCapturedChat = onSend")
    expect(inputSource).toContain("sendToCapturedChat(inputValue)")
    expect(chatSource).toContain("inputValueOverride ?? editorRef.current?.getValue()")
  })

  it("keeps background transcript and visible-chat typing in separate drafts", () => {
    localStorage.clear()
    saveGlobalDrafts({
      "chat-a:conversation-a": {
        text: "typed in A",
        updatedAt: 1,
        files: [{ id: "file-1", filename: "note.txt", base64Data: "bm90ZQ==" }],
      },
      "chat-b:conversation-b": { text: "typed in B", updatedAt: 1 },
    })

    updateSubChatDraftText("chat-a", "conversation-a", "typed in A dictated for A")

    expect(getSubChatDraft("chat-a", "conversation-a")).toBe("typed in A dictated for A")
    expect(getSubChatDraft("chat-b", "conversation-b")).toBe("typed in B")
    expect(loadGlobalDrafts()["chat-a:conversation-a"]?.files).toHaveLength(1)
  })

  it("owns unsent new-chat drafts independently", () => {
    localStorage.clear()
    updateNewChatDraftText("draft-a", "voice for A")
    updateNewChatDraftText("draft-b", "typing for B")
    expect(loadGlobalDrafts()["draft-a"]?.text).toBe("voice for A")
    expect(loadGlobalDrafts()["draft-b"]?.text).toBe("typing for B")
  })

  it("hosts recording above chat navigation and exposes return and stop actions", () => {
    const contentSource = fs.readFileSync(
      path.join(process.cwd(), "src/renderer/features/agents/ui/agents-content.tsx"),
      "utf8",
    )
    const sessionSource = fs.readFileSync(
      path.join(process.cwd(), "src/renderer/features/agents/voice/dictation-session.tsx"),
      "utf8",
    )
    expect(contentSource).toContain("<DictationSessionProvider>")
    expect(sessionSource).toContain('aria-label="Stop background dictation"')
    expect(sessionSource).toContain("Go back")
    expect(sessionSource).not.toContain('window.addEventListener("blur"')
    expect(sessionSource).not.toContain('document.addEventListener("visibilitychange"')
  })
})
