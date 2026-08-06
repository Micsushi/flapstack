import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

describe("Stage 6 renderer/main workbench session integration", () => {
  it("waits for the destination renderer to subscribe before delivering a new-window transfer", () => {
    const main = readFileSync("src/main/windows/main.ts", "utf8")
    const preload = readFileSync("src/preload/index.ts", "utf8")

    expect(main).toContain('"chat-transfer:renderer-ready"')
    expect(preload).toContain('ipcRenderer.send("chat-transfer:renderer-ready")')
  })
  it("exposes validated get/update IPC and synchronizes each committed layout", () => {
    const main = read("src/main/windows/main.ts")
    const preload = read("src/preload/index.ts")
    const renderer = read("src/renderer/features/agents/ui/agents-content.tsx")

    expect(main).toContain('"workbench-session:get"')
    expect(main).toContain('"workbench-session:update-presentation"')
    expect(main).toContain("chatWorkbenchSessionPresentationSchema.safeParse")
    expect(preload).toContain('ipcRenderer.invoke("workbench-session:get"')
    expect(preload).toContain('ipcRenderer.invoke("workbench-session:update-presentation"')
    expect(renderer).toContain("updateWorkbenchSessionPresentation")
    expect(renderer).toContain("getWorkbenchSession")
    expect(renderer).toContain("compact: chatWorkbenchCompactRef.current")
  })

  it("promotes through the existing Saved Workspace mutation and identity adapter", () => {
    const renderer = read("src/renderer/features/agents/ui/agents-content.tsx")
    expect(renderer).toContain("trpc.savedWorkspaces.create.useMutation()")
    expect(renderer).toContain("chatWorkbenchToSavedWorkspace")
    expect(renderer).toContain('scope: { type: "project"')
    expect(renderer).not.toMatch(/insert\(chats\)|insert\(agentRuns\)|INSERT INTO chats/i)
  })

  it("fails closed until every visible Chat has editable ownership and supports explicit takeover", () => {
    const main = read("src/main/windows/main.ts")
    const preload = read("src/preload/index.ts")
    const renderer = read("src/renderer/features/agents/ui/agents-content.tsx")

    expect(main).toContain('"chat:take-ownership"')
    expect(main).toContain("compareAndTransferChat")
    expect(preload).toContain('ipcRenderer.invoke("chat:take-ownership"')
    expect(renderer).toContain("editableWorkbenchChatIds")
    expect(renderer).toContain("workbenchChatIds.filter")
    expect(renderer).toContain("onWorkspaceOwnershipChanged")
    expect(renderer).toContain("desktop.takeChatOwnership")
  })

  it("wires exact cross-window/outside drag targets and rolls back failed renderer commits", () => {
    const main = read("src/main/windows/main.ts")
    const preload = read("src/preload/index.ts")
    const renderer = read("src/renderer/features/agents/ui/agents-content.tsx")
    const workbench = read("src/renderer/features/agents/workbench/chat-workbench.tsx")

    expect(main).toContain('"chat-transfer:drop-existing"')
    expect(main).toContain('"chat-transfer:drop-outside"')
    expect(main).toContain("overRegisteredWindow")
    expect(preload).toContain('ipcRenderer.invoke("chat-transfer:drop-existing"')
    expect(preload).toContain('ipcRenderer.invoke("chat-transfer:drop-outside"')
    expect(workbench).toContain("event.dataTransfer.dropEffect !==")
    expect(workbench).toContain("distance < 12")
    expect(renderer).toContain("if (!destinationGroup)")
    expect(renderer).toContain("await desktop.abortChatTransfer(transfer.nonce)")
    expect(renderer).toContain('committed.status !== "destination-committed"')
    expect(renderer).toContain('committed.status !== "completed"')
    expect(renderer).toContain("layoutBeforeTransfer")
    expect(renderer).toContain("layoutBeforeRemoval")
  })

  it("mounts virtualized offscreen search and overview targets before querying or focusing", () => {
    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")

    expect(activeChat).toContain("messageVirtualizerRef")
    expect(activeChat).toContain(
      "messageVirtualizerRef.current?.scrollToMessage(currentSearchMatch.messageId",
    )
    expect(activeChat).toContain("messageVirtualizerRef.current?.scrollToMessage(marker.id")
    expect(activeChat).toContain("scrollElementRef={chatContainerRef}")
    expect(activeChat).toContain("virtualizerRef={messageVirtualizerRef}")
  })
})
