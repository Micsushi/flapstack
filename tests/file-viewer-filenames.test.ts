import { expect, it } from "vitest"
import { getFileName } from "../src/renderer/features/file-viewer/utils/file-utils"
import { getMonacoLanguage } from "../src/renderer/features/file-viewer/utils/language-map"

it.each([
  ["C:\\repo\\Dockerfile", "Dockerfile", "dockerfile"],
  ["\\\\server\\share\\Makefile", "Makefile", "makefile"],
  ["C:/repo/src/雪.ts", "雪.ts", "typescript"],
  ["/repo/Dockerfile", "Dockerfile", "dockerfile"],
  ["/repo/literal\\Dockerfile", "literal\\Dockerfile", "plaintext"],
  ["literal\\Dockerfile", "literal\\Dockerfile", "plaintext"],
])("keeps native file label and language for %s", (path, name, language) => {
  expect(getFileName(path)).toBe(name)
  expect(getMonacoLanguage(path)).toBe(language)
})
