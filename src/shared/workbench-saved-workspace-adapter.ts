import {
  chatWorkbenchLayoutSchema,
  collectChatGroups,
  type ChatGroupNode,
  type ChatWorkbenchLayout,
} from "./chat-workbench"
import {
  savedWorkspaceLayoutSchema,
  type SavedWorkspaceLayout,
  type SavedWorkspaceLayoutNode,
} from "./saved-workspaces"

export function chatWorkbenchToSavedWorkspace(input: ChatWorkbenchLayout): SavedWorkspaceLayout {
  const layout = chatWorkbenchLayoutSchema.parse(input)
  let paneSequence = 0
  const convert = (node: ChatGroupNode): SavedWorkspaceLayoutNode => {
    if (node.type === "split") {
      return {
        type: "split",
        id: node.id,
        direction: node.direction,
        sizes: [...node.sizes],
        children: node.children.map(convert),
      }
    }
    return {
      type: "tabs",
      id: node.id,
      activePaneId: paneId(++paneSequence),
      panes: node.chatIds.map((chatId, index) => {
        const id = index === 0 ? paneId(paneSequence) : paneId(++paneSequence)
        return { id, binding: { type: "chat", chatId } }
      }),
    }
  }
  const root = convert(layout.root)
  setActivePaneIds(root, layout)
  return savedWorkspaceLayoutSchema.parse({ version: 1, root })
}

export function savedWorkspaceToChatWorkbench(input: SavedWorkspaceLayout): ChatWorkbenchLayout {
  const workspace = savedWorkspaceLayoutSchema.parse(input)
  const convert = (node: SavedWorkspaceLayoutNode): ChatGroupNode | null => {
    if (node.type === "split") {
      const children = node.children.flatMap((child) => {
        const converted = convert(child)
        return converted ? [converted] : []
      })
      if (children.length === 0) return null
      if (children.length === 1) return children[0]
      const retainedIndexes = node.children.flatMap((child, index) =>
        convert(child) ? [index] : [],
      )
      const sizes = retainedIndexes.map((index) => node.sizes[index])
      const total = sizes.reduce((sum, size) => sum + size, 0)
      return {
        type: "split",
        id: node.id,
        direction: node.direction,
        children,
        sizes: sizes.map((size) => size / total),
      }
    }
    const panes = node.panes.filter(
      (pane): pane is typeof pane & { binding: { type: "chat"; chatId: string } } =>
        pane.binding.type === "chat",
    )
    if (panes.length === 0) return null
    const active = panes.find((pane) => pane.id === node.activePaneId) ?? panes[0]
    return {
      type: "group",
      id: node.id,
      chatIds: panes.map((pane) => pane.binding.chatId),
      activeChatId: active.binding.chatId,
    }
  }
  const root = convert(workspace.root)
  if (!root) throw new Error("Saved Workspace has no Chat panes.")
  const groups = collectChatGroups(root)
  return chatWorkbenchLayoutSchema.parse({
    version: 1,
    root,
    activeGroupId: groups[0].id,
    maximizedGroupId: null,
  })
}

function setActivePaneIds(node: SavedWorkspaceLayoutNode, layout: ChatWorkbenchLayout): void {
  if (node.type === "split") {
    node.children.forEach((child) => setActivePaneIds(child, layout))
    return
  }
  const source = collectChatGroups(layout.root).find((group) => group.id === node.id)
  const active = node.panes.find(
    (pane) => pane.binding.type === "chat" && pane.binding.chatId === source?.activeChatId,
  )
  if (active) node.activePaneId = active.id
}

function paneId(sequence: number): string {
  return `workbench-chat-pane-${sequence}`
}
