import { describe, expect, it } from "vitest"
import {
  isExecutableExternalPath,
  isSafeExternalUrl,
  isTrustedRendererNavigation,
} from "../src/main/lib/open-external"

describe("external navigation safety", () => {
  it("allows only explicit external protocols", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true)
    expect(isSafeExternalUrl("mailto:test@example.com")).toBe(true)
    expect(isSafeExternalUrl("file:///C:/Windows/System32/cmd.exe")).toBe(false)
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false)
  })

  it("keeps renderer navigation on the trusted development origin", () => {
    expect(
      isTrustedRendererNavigation(
        "http://localhost:5175/settings?tab=agents",
        "http://localhost:5175",
        "C:/app/renderer/index.html",
      ),
    ).toBe(true)
    expect(
      isTrustedRendererNavigation(
        "https://example.com",
        "http://localhost:5175",
        "C:/app/renderer/index.html",
      ),
    ).toBe(false)
  })

  it("allows only the packaged renderer file", () => {
    const rendererFile = "C:/app/renderer/index.html"
    expect(
      isTrustedRendererNavigation(
        "file:///C:/app/renderer/index.html#chat",
        undefined,
        rendererFile,
      ),
    ).toBe(true)
    expect(
      isTrustedRendererNavigation("file:///C:/app/renderer/other.html", undefined, rendererFile),
    ).toBe(false)
  })

  it("blocks executable file types regardless of case", () => {
    expect(isExecutableExternalPath("C:/project/setup.PS1")).toBe(true)
    expect(isExecutableExternalPath("C:/project/readme.md")).toBe(false)
  })
})
