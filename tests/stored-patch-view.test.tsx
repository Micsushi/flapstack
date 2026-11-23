// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

const renderer = vi.hoisted(() => ({ fail: false, files: [] as any[] }))
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff, options }: any) => {
    if (renderer.fail) throw new Error("renderer unavailable")
    renderer.files.push({ fileDiff, options })
    return <span data-rendered-file={fileDiff.name} />
  },
}))
import { StoredPatchView } from "../src/renderer/features/agents/ui/stored-patch-view"
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const patch = (name: string) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
async function render(value: string) {
  renderer.files = []
  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => root.render(<StoredPatchView patch={value} />))
  return { host, close: () => act(async () => root.unmount()) }
}
it("parses every stored file and retains exact original bytes in raw disclosure", async () => {
  const original = patch("one.txt") + patch("two.txt")
  const f = await render(original)
  try {
    expect(
      [...f.host.querySelectorAll("section")].map((el) => el.getAttribute("aria-label")),
    ).toEqual(["one.txt", "two.txt"])
    expect(f.host.querySelector("details pre")?.textContent).toBe(original)
    expect(renderer.files.map(({ fileDiff }) => fileDiff.isPartial)).toEqual([true, true])
    expect(renderer.files.every(({ options }) => options.diffStyle === "unified")).toBe(true)
  } finally {
    await f.close()
  }
})
it.each([
  "malformed\r\n+ untouched\r\n",
  patch("broken.txt").replace("@@ -1 +1 @@", "@@ -1,9 +1,9 @@"),
  "diff --git a/image.png b/image.png\nGIT binary patch\nliteral 0\n",
  "x\n".repeat(2001),
  "x".repeat(500001),
  "",
])("falls back without altering unsupported content (%#)", async (original) => {
  const f = await render(original)
  try {
    expect(f.host.querySelector("pre")?.textContent).toBe(original)
    expect(renderer.files).toHaveLength(0)
  } finally {
    await f.close()
  }
})
it("retains raw content if rendering fails", async () => {
  renderer.fail = true
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  const f = await render(patch("one.txt"))
  try {
    expect(f.host.querySelector("pre")?.textContent).toBe(patch("one.txt"))
  } finally {
    renderer.fail = false
    log.mockRestore()
    await f.close()
  }
})
