import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  RUN_PERMISSION_MODE_OPTIONS,
  isSelectableRunPermissionMode,
} from "../src/renderer/features/agents/constants"
import {
  HIDDEN_SETTINGS_TABS,
  normalizeVisibleSettingsTab,
} from "../src/renderer/features/settings/settings-visibility"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Settings release visibility", () => {
  it("redirects hidden tabs without removing their stored identifiers", () => {
    expect(HIDDEN_SETTINGS_TABS).toEqual(["profile", "worktrees", "beta", "future"])
    for (const tab of HIDDEN_SETTINGS_TABS) {
      expect(normalizeVisibleSettingsTab(tab)).toBe("preferences")
    }
    expect(normalizeVisibleSettingsTab("voice")).toBe("voice")
    expect(normalizeVisibleSettingsTab("agents")).toBe("agents")
    expect(normalizeVisibleSettingsTab("keyboard")).toBe("keyboard")
    expect(normalizeVisibleSettingsTab("debug")).toBe("preferences")
    expect(normalizeVisibleSettingsTab("debug", { showDevelopment: true })).toBe("debug")
  })

  it("offers only permission modes with complete user-facing behavior", () => {
    expect(RUN_PERMISSION_MODE_OPTIONS).toEqual(["read-only", "ask-before-edits", "full-access"])
    expect(isSelectableRunPermissionMode("custom")).toBe(false)
    expect(isSelectableRunPermissionMode("auto-edit-project-only")).toBe(false)
  })

  it("keeps plaintext key and model override editors out of Models", () => {
    const source = readSource("src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx")
    expect(source).not.toContain("API Keys")
    expect(source).not.toContain("OpenAI API Key")
    expect(source).not.toContain("Override Model")
    expect(source).not.toContain("ANTHROPIC_AUTH_TOKEN")
    expect(source).toContain("Codex API key")
    expect(source).toContain('setActiveSettingsTab("api-providers")')
    expect(source).not.toContain("handleRemoveCodexApiKey")
  })

  it("keeps post-onboarding key controls available on their safe surfaces", () => {
    const codexLogin = readSource("src/renderer/features/agents/components/codex-login-content.tsx")
    const voice = readSource("src/renderer/components/dialogs/settings-tabs/agents-voice-tab.tsx")
    const manager = readSource(
      "src/renderer/components/dialogs/settings-tabs/credential-management.tsx",
    )
    expect(codexLogin).toContain('nextMethod === "chatgpt" ? "ChatGPT" : "API key"')
    expect(voice).toContain("OpenAI transcription API key")
    expect(voice).toContain('setActiveSettingsTab("api-providers")')
    expect(voice).not.toContain("trpc.voice.setOpenAIKey")
    expect(manager).toContain("Session only")
    expect(manager).toContain("trpc.voice.setOpenAIKey")

    const claudeLogin = readSource("src/renderer/components/dialogs/claude-login-modal.tsx")
    expect(claudeLogin).not.toContain("Set a custom model in Settings")
    expect(claudeLogin).toContain("Manage Claude accounts in Settings")
  })

  it("keeps the retired quick-switch preference inert", () => {
    const preferences = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
    )
    const content = readSource("src/renderer/features/agents/ui/agents-content.tsx")
    expect(preferences).not.toContain("preferences-quick-switch")
    expect(preferences).not.toContain("ctrlTabTargetAtom")
    expect(content).not.toContain("ctrlTabTargetAtom")
    expect(content).toContain("const ctrlTabTarget = getReleasedCtrlTabTarget()")
    expect(content).toContain('return "workspaces"')
  })
})
