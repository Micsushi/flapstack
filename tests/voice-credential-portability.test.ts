import { describe, expect, it, vi } from "vitest"
import { readOpenAIKeyFromShell } from "../src/main/lib/speech/stt-cloud"

describe("voice credential portability", () => {
  it("never invokes a POSIX login shell on Windows", () => {
    const runner = vi.fn()
    expect(readOpenAIKeyFromShell("win32", runner)).toBeNull()
    expect(runner).not.toHaveBeenCalled()
  })

  it("uses an argument array for the optional macOS login-shell fallback", () => {
    const runner = vi.fn().mockReturnValue("sk-test-value")
    expect(readOpenAIKeyFromShell("darwin", runner, { SHELL: "/bin/zsh" })).toBe("sk-test-value")
    expect(runner).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-ilc", 'printf %s "$OPENAI_API_KEY"'],
      expect.objectContaining({ encoding: "utf8", timeout: 5000 }),
    )
  })
})
