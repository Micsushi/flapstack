import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("tRPC window ownership", () => {
  it("binds each request context to the IPC sender instead of global focus", () => {
    const source = readFileSync("src/main/windows/main.ts", "utf8")
    expect(source).toContain("createContext: async ({ event })")
    expect(source).toContain("getWindow: () => BrowserWindow.fromWebContents(event.sender)")
    expect(source).not.toContain("createContext: async () => ({\n          getWindow,")
  })

  it("does not fall back to an unrelated focused window for dialog procedures", () => {
    const routerDirectory = "src/main/lib/trpc/routers"
    for (const name of readdirSync(routerDirectory).filter((entry) => entry.endsWith(".ts"))) {
      const path = join(routerDirectory, name)
      expect(readFileSync(path, "utf8")).not.toContain("BrowserWindow.getFocusedWindow()")
    }
  })
})
