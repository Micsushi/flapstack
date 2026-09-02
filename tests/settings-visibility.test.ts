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
    expect(HIDDEN_SETTINGS_TABS).toEqual(["profile", "worktrees", "future"])
    for (const tab of HIDDEN_SETTINGS_TABS) {
      expect(normalizeVisibleSettingsTab(tab)).toBe("preferences")
    }
    expect(normalizeVisibleSettingsTab("voice")).toBe("voice")
    expect(normalizeVisibleSettingsTab("agents")).toBe("agents")
    expect(normalizeVisibleSettingsTab("keyboard")).toBe("keyboard")
    expect(normalizeVisibleSettingsTab("beta")).toBe("beta")
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
    const claudeAuthPanel = readSource("src/renderer/components/claude-local-auth-panel.tsx")
    const claudeCodeRouter = readSource("src/main/lib/trpc/routers/claude-code.ts")
    expect(claudeLogin).not.toContain("Set a custom model in Settings")
    expect(claudeLogin).toContain("Manage Claude accounts in Settings")
    expect(claudeLogin).not.toContain("terminal_open")
    expect(claudeAuthPanel).toContain("no Terminal window opens")
    expect(claudeAuthPanel).toContain("Authorization code")
    expect(claudeCodeRouter).not.toContain("openClaudeAuthTerminal")
    expect(claudeCodeRouter).not.toContain("osascript")
    expect(claudeCodeRouter).toContain('stdio: ["pipe", "pipe", "pipe"]')
  })

  it("uses live provider state after first-run setup", () => {
    const app = readSource("src/renderer/App.tsx")
    const billing = readSource("src/renderer/features/onboarding/billing-method-page.tsx")
    const chatInput = readSource("src/renderer/features/agents/main/chat-input-area.tsx")
    const newChat = readSource("src/renderer/features/agents/main/new-chat-form.tsx")

    expect(app).toContain("<BillingMethodPage />")
    expect(app).toContain("claudeCode.getIntegration.useQuery")
    expect(app).toContain("codex.getIntegration.useQuery")
    expect(app).toContain("claudeIntegration.data?.isConnected && !billingMethod")
    expect(app).not.toContain('setBillingMethod("api-key")')
    expect(billing).toContain('setBillingMethod("local-only")')
    expect(chatInput).not.toContain("anthropicOnboardingCompletedAtom")
    expect(chatInput).not.toContain("codexOnboardingCompletedAtom")
    expect(newChat).not.toContain("anthropicOnboardingCompletedAtom")
    expect(newChat).not.toContain("codexOnboardingCompletedAtom")
  })

  it("keeps the retired quick-switch preference inert", () => {
    const preferences = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
    )
    const content = readSource("src/renderer/features/agents/ui/agents-content.tsx")
    const atoms = readSource("src/renderer/lib/atoms/index.ts")
    expect(preferences).not.toContain("preferences-quick-switch")
    expect(preferences).not.toContain("ctrlTabTargetAtom")
    expect(content).not.toContain("ctrlTabTargetAtom")
    expect(content).toContain("const ctrlTabTarget = getReleasedCtrlTabTarget()")
    expect(atoms).toContain("export function getReleasedCtrlTabTarget")
    expect(atoms).toContain('return "workspaces"')
  })
})
