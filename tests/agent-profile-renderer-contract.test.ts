import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const startDialog = readFileSync(
  resolve(process.cwd(), "src/renderer/features/agent-profiles/start-agent-dialog.tsx"),
  "utf8",
)
const profileStudio = readFileSync(
  resolve(
    process.cwd(),
    "src/renderer/components/dialogs/settings-tabs/agents-profiles-studio-tab.tsx",
  ),
  "utf8",
)

describe("Agent Profile standalone renderer contract", () => {
  it("joins task-origin launches to the active task while Studio remains unowned", () => {
    expect(startDialog).toContain("trpc.spawnedAgents.getTaskOverview.useQuery")
    expect(startDialog).toContain('!["completed", "failed", "stopped"].includes')
    expect(startDialog).toContain("orchestrationTaskId,")
    expect(startDialog).toContain("disabled={!selected || taskOrchestration.isLoading}")
    expect(profileStudio).toContain('source: { kind: "studio", projectId }')
    expect(profileStudio).toMatch(
      /source: \{ kind: "studio", projectId \}[\s\S]+?orchestrationTaskId: null/,
    )
  })

  it("exposes explicit safe lifecycle actions for the launch returned to the dialog", () => {
    expect(startDialog).toContain("retryStandalone.useMutation")
    expect(startDialog).toContain("stopStandalone.useMutation")
    expect(startDialog).toContain("continueStandaloneWithUpdatedProfile.useMutation")
    expect(startDialog).toContain("Retry frozen snapshot")
    expect(startDialog).toContain("Continue with updated profile")
    expect(startDialog).toContain("Select a different profile or a newer profile version")
    expect(startDialog).toContain('source: { kind: "chat" as const, chatId: currentLaunch.chatId }')
    expect(startDialog).toContain("orchestrationTaskId: currentLaunch.orchestrationTaskId")
    expect(startDialog).toContain("confirmedSnapshotDigest: continuationPreview.digest")
  })

  it("keeps Profile Studio flows keyboard-native and screen-reader labeled", () => {
    for (const mutation of [
      "agentProfiles.create.useMutation",
      "agentProfiles.update.useMutation",
      "agentProfiles.duplicate.useMutation",
      "agentProfiles.archive.useMutation",
      "agentProfiles.restore.useMutation",
      "agentProfiles.export.useMutation",
      "agentProfiles.importPreview.useMutation",
      "agentProfiles.importConfirm.useMutation",
      "agentProfiles.launchStandalone.useMutation",
      "agentProfiles.bindWorkflowStep.useMutation",
    ]) {
      expect(profileStudio).toContain(mutation)
    }
    expect(profileStudio).toContain('type="search"')
    expect(profileStudio).toContain('aria-label="Search Agent Profiles"')
    expect(profileStudio).toContain('role="listbox"')
    expect(profileStudio).toContain('role="option"')
    expect(profileStudio).toContain("aria-selected={selectedId === profile.id}")
    expect(profileStudio).toContain('aria-labelledby="profile-capability-heading"')
    expect(profileStudio).toContain('aria-labelledby="profile-personality-heading"')
    expect(profileStudio).toContain('aria-live="polite"')
    expect(profileStudio).toContain(
      "Capability controls authority. Personality controls presentation only.",
    )
  })
})
