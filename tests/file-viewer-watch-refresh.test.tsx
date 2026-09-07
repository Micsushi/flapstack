// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  data: { ok: true, content: "text", byteLength: 4 } as
    | { ok: true; content: string; byteLength: number }
    | { ok: false; reason: "unsupported-encoding"; byteLength: number },
  refetch: vi.fn(),
  subscription: null as null | {
    enabled: boolean
    onData: (event: { filename: string; eventType: string }) => void
  },
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    files: {
      readTextFile: {
        useQuery: () => ({
          data: state.data,
          isLoading: false,
          refetch: state.refetch,
        }),
      },
      watchChanges: {
        useSubscription: (_input: unknown, options: NonNullable<typeof state.subscription>) => {
          state.subscription = options
        },
      },
    },
  },
}))
import {
  getErrorMessage,
  useFileContent,
} from "../src/renderer/features/file-viewer/hooks/use-file-content"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = undefined
  state.refetch = vi.fn()
  state.subscription = null
  state.data = { ok: true, content: "text", byteLength: 4 }
})
function Fixture({ projectPath, filePath }: { projectPath: string; filePath: string }) {
  const result = useFileContent(projectPath, filePath)
  return result.error ? (
    <p role="alert">{getErrorMessage(result.error)}</p>
  ) : (
    <pre>{result.content}</pre>
  )
}
async function render(projectPath: string, filePath: string) {
  if (!root) {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root!.render(<Fixture projectPath={projectPath} filePath={filePath} />))
}
it.each([
  ["C:\\Work\\Repo", "c:/work/repo/src/雪.ts", "src\\雪.ts"],
  ["\\\\Server\\Share\\Repo", "//server/share/repo/src/a.md", "SRC\\A.MD"],
  ["C:\\Work\\Repo", "src/a.ts", "src\\a.ts"],
  ["/work/repo", "/work/repo/src/a.ts", "src/a.ts"],
  ["/work/repo", "a\\b.ts", "a\\b.ts"],
])("refreshes the open file for native watcher paths under %s", async (project, file, changed) => {
  await render(project, file)
  expect(state.subscription?.enabled).toBe(true)
  state.subscription!.onData({ filename: changed, eventType: "change" })
  expect(state.refetch).toHaveBeenCalledOnce()
})
it("keeps POSIX case and literal backslashes distinct and uses the latest refetch", async () => {
  await render("/repo", "/repo/a\\b.ts")
  state.subscription!.onData({ filename: "a/b.ts", eventType: "change" })
  state.subscription!.onData({ filename: "A\\b.ts", eventType: "change" })
  expect(state.refetch).not.toHaveBeenCalled()
  const previous = state.refetch
  state.refetch = vi.fn()
  await render("/repo", "/repo/a\\b.ts")
  state.subscription!.onData({ filename: "a\\b.ts", eventType: "unlink" })
  expect(state.refetch).toHaveBeenCalledOnce()
  expect(previous).not.toHaveBeenCalled()
})
it("disables watchers outside the selected root and follows navigation", async () => {
  await render("C:\\repo", "C:\\repo-other\\a.ts")
  expect(state.subscription?.enabled).toBe(false)
  await render("C:\\repo", "C:\\repo\\new.ts")
  state.subscription!.onData({ filename: "old.ts", eventType: "change" })
  expect(state.refetch).not.toHaveBeenCalled()
  state.subscription!.onData({ filename: "new.ts", eventType: "add" })
  expect(state.refetch).toHaveBeenCalledOnce()
})

it("shows an encoding recovery hint rather than missing-file or lossy content", async () => {
  state.data = { ok: false, reason: "unsupported-encoding", byteLength: 2 }
  await render("/repo", "/repo/a.md")
  expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
    "This preview requires UTF-8. Open the file in an external editor.",
  )
  expect(container!.querySelector("pre")).toBeNull()
})
