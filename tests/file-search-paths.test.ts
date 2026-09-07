import { expect, it } from "vitest"
import {
  fileSearchPathKey,
  joinFileSearchPath,
  recentFileSearchItems,
} from "../src/renderer/features/file-viewer/components/file-search-paths"
import { toRootedFileTarget } from "../src/renderer/lib/file-target"

it("preserves literal POSIX backslashes in file names and roots", () => {
  expect(recentFileSearchItems("/repo", ["/repo/a\\b.ts"], "")[0]).toMatchObject({
    path: "a\\b.ts",
    label: "a\\b.ts",
  })
  expect(joinFileSearchPath("/repo\\", "a.ts")).toBe("/repo\\/a.ts")
  expect(fileSearchPathKey("/repo", "a\\b.ts")).not.toBe(fileSearchPathKey("/repo", "a/b.ts"))
})

it("finds and deduplicates Windows recent files across separator and drive casing", () => {
  const items = recentFileSearchItems(
    "C:\\Work\\Repo\\",
    ["c:\\work\\repo\\src\\App.tsx", "C:/Work/Repo/src/app.tsx", "C:/Work/Repo-other/private.txt"],
    "src",
  )
  expect(items).toEqual([{ id: "recent-src/app.tsx", label: "App.tsx", path: "src/App.tsx" }])
  expect(fileSearchPathKey("C:\\Work\\Repo", "src\\APP.tsx")).toBe("src/app.tsx")
  expect(
    fileSearchPathKey("C:\\Work\\Repo", joinFileSearchPath("C:\\Work\\Repo\\", "src/App.tsx")),
  ).toBe(fileSearchPathKey("C:\\Work\\Repo", "c:\\work\\repo\\src\\App.tsx"))
})

it("matches UNC roots case-insensitively without crossing share boundaries", () => {
  expect(
    toRootedFileTarget("\\\\Server\\Share\\Repo", "//server/share/repo/src/a.ts"),
  ).toMatchObject({ relativePath: "src/a.ts" })
  expect(recentFileSearchItems("\\\\Server\\Share", ["//server/share-other/a.ts"], "")).toEqual([])
})

it("preserves POSIX case and excludes unrelated or relative recent entries", () => {
  expect(
    recentFileSearchItems(
      "/work/repo",
      ["/work/repo/A.ts", "/work/repo/a.ts", "/Work/repo/x.ts", "a.ts", "/work/repo2/x.ts"],
      "",
    ),
  ).toHaveLength(2)
  expect(fileSearchPathKey("/work/repo", "A.ts")).not.toBe(fileSearchPathKey("/work/repo", "a.ts"))
})
