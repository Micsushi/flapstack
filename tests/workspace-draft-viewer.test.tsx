// @vitest-environment jsdom
import React, { act, useEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  enabled: true,
  content: "retained draft",
  updates: vi.fn(),
  flush: vi.fn(async () => true),
  save: vi.fn(async () => true),
  change: null as null | ((value: string) => void),
  editor: {
    getDomNode: () => null,
    onDidChangeCursorSelection: vi.fn(),
    trigger: vi.fn(),
    getValue: () => "overshot undo",
    getModel: () => ({ getFullModelRange: () => "full range" }),
    executeEdits: vi.fn(),
    pushUndoStop: vi.fn(),
  },
}))
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, options, onMount }: any) => {
    const previous = useRef(onChange)
    useEffect(() => {
      onMount(state.editor, {})
    }, [])
    state.change = onChange
    // Reproduce Monaco React's read-only setValue emitting the old listener
    // before its effect installs the replacement onChange callback.
    useEffect(() => {
      if (options.readOnly) previous.current?.(value)
    }, [value])
    useEffect(() => {
      previous.current = onChange
    }, [onChange])
    return (
      <textarea
        aria-label="Test editor"
        readOnly={options.readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  },
}))
vi.mock("../src/renderer/features/file-viewer/components/monaco-config", () => ({
  defaultEditorOptions: {},
  getMonacoTheme: () => "light",
  registerMonacoTheme: () => "light",
}))
vi.mock("../src/renderer/features/file-viewer/hooks/use-workspace-draft", () => ({
  useWorkspaceDraft: (input: any) => ({
    session: input
      ? {
          setContent: state.updates,
          flush: state.flush,
          save: state.save,
          refreshDisk: vi.fn(),
          needsRetry: () => false,
          hasUnpersistedText: () => false,
          getSnapshot: () => ({ content: state.content }),
        }
      : null,
    state: {
      phase: input ? "ready" : "opening",
      content: state.content,
      draft: input ? { id: "draft" } : null,
      disk: { content: "disk preview" },
      busy: false,
      conflict: false,
      error: null,
    },
  }),
}))
vi.mock("../src/renderer/features/file-viewer/hooks/use-file-content", () => ({
  useFileContent: () => ({ content: "disk preview", isLoading: false, error: null }),
  getErrorMessage: (error: string) => error,
}))
vi.mock("../src/renderer/features/file-viewer/hooks/use-file-change-refresh", () => ({
  useFileChangeRefresh: vi.fn(),
}))
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => ({ workspaceEditing: state.enabled }),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: { external: { openInApp: { useMutation: () => ({ mutate: vi.fn() }) } } },
}))
vi.mock("../src/renderer/lib/themes", () => ({ useVSCodeTheme: () => ({ currentTheme: null }) }))
vi.mock("../src/renderer/lib/hotkeys", () => ({ useResolvedHotkeyDisplay: () => "" }))
vi.mock("../src/renderer/features/agents/mentions/agents-file-mention", () => ({
  getFileIconByExtension: () => null,
}))
vi.mock("../src/renderer/features/agents/ui/message-action-buttons", () => ({
  CopyButton: () => null,
}))
vi.mock("../src/renderer/features/file-viewer/components/image-viewer", () => ({
  ImageViewer: () => null,
}))
vi.mock("../src/renderer/features/file-viewer/components/markdown-viewer", () => ({
  MarkdownViewer: () => null,
}))
import { TooltipProvider } from "../src/renderer/components/ui/tooltip"
import { FileViewerSidebar } from "../src/renderer/features/file-viewer/components/file-viewer-sidebar"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = undefined
  state.enabled = true
  state.content = "retained draft"
  vi.clearAllMocks()
})
async function render(filePath = "/repo/file.ts", chatId = "chat") {
  if (!root) {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () =>
    root!.render(
      <TooltipProvider>
        <FileViewerSidebar
          filePath={filePath}
          projectPath="/repo"
          workspaceScope={{ projectId: "project", chatId }}
          onClose={() => {}}
        />
      </TooltipProvider>,
    ),
  )
}
it("does not route read-only preview replacement into the previous draft callback", async () => {
  await render()
  const editable = container!.querySelector("textarea")!
  expect(editable.value).toBe("retained draft")
  state.enabled = false
  await render()
  expect(container!.querySelector("textarea")).not.toBe(editable)
  expect(container!.querySelector("textarea")!.value).toBe("disk preview")
  expect(state.updates).not.toHaveBeenCalled()
  state.enabled = true
  await render()
  expect(container!.querySelector("textarea")!.value).toBe("retained draft")
  expect(state.updates).not.toHaveBeenCalled()
})
it("isolates editor models across file and chat navigation", async () => {
  await render()
  const first = container!.querySelector("textarea")
  await render("/repo/next.ts")
  const second = container!.querySelector("textarea")
  expect(second).not.toBe(first)
  await render("/repo/next.ts", "another-chat")
  expect(container!.querySelector("textarea")).not.toBe(second)
  expect(state.updates).not.toHaveBeenCalled()
})

it("restores the exact valid buffer when rejected input undo includes earlier typing", async () => {
  await render()
  state.updates.mockReturnValueOnce(false)
  await act(async () => state.change!("retained draft\0"))
  expect(state.editor.trigger).toHaveBeenCalledWith("draft-validation", "undo", null)
  expect(state.editor.executeEdits).toHaveBeenCalledWith("draft-validation", [
    { range: "full range", text: "retained draft", forceMoveMarkers: true },
  ])
  expect(state.editor.pushUndoStop).toHaveBeenCalledOnce()
})
