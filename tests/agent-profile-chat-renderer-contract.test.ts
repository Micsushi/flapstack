import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("Agent Profile regular Chat renderer contract", () => {
  it("keeps the new-Chat picker searchable, exact, responsive, and non-launching", () => {
    const source = read("src/renderer/features/agent-profiles/new-chat-agent-profile-selector.tsx")
    expect(source).toContain('aria-labelledby="new-chat-agent-profile-heading"')
    expect(source).toContain('role="listbox"')
    expect(source).toContain('aria-label="Compatible Agent Profiles"')
    expect(source).toContain("previewNewChatBinding.useQuery")
    expect(source).toContain("profile.profileId")
    expect(source).toContain("profile.version")
    expect(source).toContain("runtimeResolution.preference")
    expect(source).toContain("capability.reasoningEffort")
    expect(source).toContain("capability.speedPreference")
    expect(source).toContain("capability.worktreeStrategy")
    expect(source).toContain("capability.skills")
    expect(source).toContain("sm:grid-cols-2")
    expect(source).not.toMatch(/\.mutate(?:Async)?\([^)]*(?:run|chat)/)
  })

  it("shows immutable provenance and prevents profile changes after the first run", () => {
    const control = read("src/renderer/features/agent-profiles/chat-agent-profile-control.tsx")
    const composer = read("src/renderer/features/agents/main/chat-input-area.tsx")
    expect(control).toContain("getChatBinding.useQuery")
    expect(control).toContain("searchForChat.useQuery")
    expect(control).toContain("previewChatBinding.fetch")
    expect(control).toContain("bindChat.useMutation")
    expect(control).toContain("This Chat has started")
    expect(control).toContain("binding.data?.invalidReason")
    expect(control).toContain("Selected profile unavailable")
    expect(control).toContain("selected.personality.ref.personalityId")
    expect(control).toContain('aria-label="Compatible Agent Profiles"')
    expect(composer).toContain("<ChatAgentProfileControl")
  })

  it("sends only a confirmed exact preview into Chat creation", () => {
    const source = read("src/renderer/features/agents/main/new-chat-form.tsx")
    expect(source).toContain("confirmedAgentProfileDigest")
    expect(source).toContain("agentProfileSelection?.profile")
    expect(source).toContain("Resolve the selected Agent Profile error")
    expect(source).toContain("agentProfileSelection?.harness")
    expect(source).toContain("agentProfileSelection?.runtimePreference")
  })

  it("routes the frozen capability and personality through both regular providers", () => {
    const claude = read("src/main/lib/trpc/routers/claude.ts")
    const codex = read("src/main/lib/trpc/routers/codex.ts")
    const authority = read("src/main/lib/agent-profiles/runtime-authority.ts")
    for (const source of [claude, codex]) {
      expect(source).toContain("AgentProfileChatBindingService")
      expect(source).toContain("materializeForRun")
      expect(source).toContain("chatProfile.instructions")
      expect(source).toContain("chatProfile?.launch.reasoningEffort")
      expect(source).toContain("chatProfile?.launch.serviceTier")
      expect(source).toContain("chatProfile?.launch.permissionMode")
      expect(source).toContain("chatProfile?.launch.customPermissions")
    }
    expect(claude).toContain("chatProfile?.launch.model")
    expect(codex).toContain("service_tier")
    expect(codex).toMatch(/handleCodexPermissionRequest[\s\S]+?isFrozenAgentProfileToolAllowed/)
    expect(authority).toContain("agent_profile_run_bindings")
  })

  it("keeps Settings Fill with AI flows on the exact profile-selection contract", () => {
    for (const path of [
      "src/renderer/components/dialogs/settings-tabs/agents-worktrees-tab.tsx",
      "src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx",
    ]) {
      const source = read(path)
      expect(source).toContain("NewChatAgentProfileSelector")
      expect(source).toContain("confirmedAgentProfileDigest")
      expect(source).toContain("agentProfile:")
    }
  })
})
