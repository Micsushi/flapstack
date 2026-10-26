import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("agents Voice catalog recovery surface", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/renderer/components/dialogs/settings-tabs/agents-voice-tab.tsx"),
    "utf8",
  )

  it("keeps auxiliary voice reads visible and retryable", () => {
    expect(source).toContain('label="voice catalog"')
    expect(source).toContain('label="speech model catalog"')
    expect(source).toContain('label="OpenAI key status"')
    expect(source).toContain("Speech model status unavailable:")
    expect(source).toContain("refetchStatus()")
    expect(source).toContain("voicesQuery.error")
    expect(source).toContain("sttModelsQuery.error")
    expect(source).toContain('role="alert"')
  })
})
