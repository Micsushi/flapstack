import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip"
import { FileSearchDialog } from "../../src/renderer/features/file-viewer/components/file-search-dialog"
import { FileViewerSidebar } from "../../src/renderer/features/file-viewer/components/file-viewer-sidebar"
import {
  DiffComments,
  type DiffCommentDraft,
} from "../../src/renderer/features/agents/ui/diff-comments"
import { Terminal } from "../../src/renderer/features/terminal/terminal"
import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"

loader.config({ monaco })
const noop = () => {}
;(window as any).desktopApi = new Proxy({}, { get: () => () => Promise.resolve(null) })

function Fixture() {
  const surface = new URLSearchParams(location.search).get("surface") || "search"
  const [draft, setDraft] = useState<DiffCommentDraft | null>(null)
  return (
    <TooltipProvider>
      <div className="h-screen bg-background text-foreground" data-fixture-surface={surface}>
        {surface === "search" ? (
          <FileSearchDialog open onOpenChange={noop} projectPath="C:/sample" onSelectFile={noop} />
        ) : surface === "editor" ? (
          <FileViewerSidebar
            filePath="C:/sample/notes.txt"
            projectPath="C:/sample"
            onClose={noop}
            workspaceScope={{ projectId: "sample", chatId: "sample" }}
          />
        ) : surface === "comments" ? (
          <div className="flex h-full flex-col justify-end">
            <DiffComments
              chatId="sample"
              draft={draft}
              setDraft={setDraft}
              onBusyChange={noop}
              displayedDiffHash="sample-hash"
              feedbackTarget={{ id: "sample-chat", name: "Polish file search" }}
            />
          </div>
        ) : (
          <Terminal paneId="sample:term:1" cwd="C:/sample" />
        )}
      </div>
    </TooltipProvider>
  )
}
createRoot(document.getElementById("root")!).render(<Fixture />)
