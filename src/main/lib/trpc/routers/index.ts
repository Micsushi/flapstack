import { router } from "../index"
import { projectsRouter } from "./projects"
import { tasksRouter } from "./tasks"
import { chatsRouter } from "./chats"
import { runsRouter } from "./runs"
import { searchRouter } from "./search"
import { attachmentsRouter } from "./attachments"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { ollamaRouter } from "./ollama"
import { codexRouter } from "./codex"
import { cursorRouter } from "./cursor"
import { terminalRouter } from "./terminal"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
import { debugRouter } from "./debug"
import { skillsRouter } from "./skills"
import { agentsRouter } from "./agents"
import { agentInputRouter } from "./agent-input"
import { worktreeConfigRouter } from "./worktree-config"
import { sandboxImportRouter } from "./sandbox-import"
import { commandsRouter } from "./commands"
import { voiceRouter } from "./voice"
import { pluginsRouter } from "./plugins"
import { permissionsRouter } from "./permissions"
import { futureStagesRouter } from "./future-stages"
import { speechRouter } from "./speech"
import { appControlRouter } from "./app-control"
import { automationsRouter } from "./automations"
import { modelProvidersRouter } from "./model-providers"
import { opencodeRouter } from "./opencode"
import { projectVaultsRouter } from "./project-vaults"
import { usageRouter } from "./usage"
import { importExportRouter } from "./import-export"
import { hooksManagementRouter } from "./hooks-management"
import { spawnedAgentsRouter } from "./spawned-agents"
import { devMcpTestControlRouter } from "./dev-mcp-test-control"
import { providerExtensionsRouter } from "./provider-extensions"
import { providerCapabilitiesRouter } from "./provider-capabilities"
import { credentialsRouter } from "./credentials"
import { planSourcesRouter } from "./plan-sources"
import { localModelsRouter } from "./local-models"
import { taskProposalsRouter } from "./task-proposals"
import { agentRuntimeDefaultsRouter } from "./agent-runtime-defaults"
import { agentActivityRouter } from "./agent-activity"
import { agentRuntimeChatRouter } from "./agent-runtime-chat"
import { savedWorkspacesRouter } from "./saved-workspaces"
import { coordinationEnginesRouter } from "./coordination-engines"
import { orchestrationOperationsRouter } from "./orchestration-operations"
import { devRuntimeActivityFixturesRouter } from "./dev-runtime-activity-fixtures"
import { agentProfilesRouter } from "./agent-profiles"
import { agentPersonalitiesRouter, createAgentPersonalityStore } from "./agent-personalities"
import { configureAgentPersonalityResolutionPort } from "../../agent-profiles/personality-resolution"
import { betaFeaturesRouter } from "./beta-features"
import { visualCaptureRouter } from "./visual-capture"
import { mobileBridgeRouter } from "./mobile-bridge"
import {
  createFeatureVisibilityRouter,
  FEATURE_VISIBILITY_CHANGED_EVENT,
} from "./feature-visibility"
import { createGitRouter } from "../../git"
import { app, BrowserWindow } from "electron"
import { join } from "node:path"
import { isDevTestControlEnabled, isPreviewExecutable } from "../../mcp-test-control/lifecycle"
import { isRuntimeActivityFixtureAvailable } from "../../agent-runtime/activity-fixture-settings"
import { IS_DEV } from "../../../constants"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 */
export function createAppRouter(getWindow: () => BrowserWindow | null) {
  configureAgentPersonalityResolutionPort({
    resolve: (ref, profileScope) =>
      createAgentPersonalityStore().resolveCombinedVisible(
        ref,
        profileScope.type === "project" ? profileScope : { type: "user", projectId: null },
      ),
  })
  const devTestControlEnabled = isDevTestControlEnabled(
    !app.isPackaged,
    app.isPackaged && isPreviewExecutable(),
  )
  const devRuntimeActivityFixturesEnabled = isRuntimeActivityFixtureAvailable(
    app.isPackaged,
    IS_DEV,
  )
  return router({
    agentInput: agentInputRouter,
    projects: projectsRouter,
    tasks: tasksRouter,
    chats: chatsRouter,
    runs: runsRouter,
    search: searchRouter,
    attachments: attachmentsRouter,
    claude: claudeRouter,
    claudeCode: claudeCodeRouter,
    claudeSettings: claudeSettingsRouter,
    anthropicAccounts: anthropicAccountsRouter,
    ollama: ollamaRouter,
    codex: codexRouter,
    cursor: cursorRouter,
    terminal: terminalRouter,
    external: externalRouter,
    files: filesRouter,
    debug: debugRouter,
    skills: skillsRouter,
    agents: agentsRouter,
    worktreeConfig: worktreeConfigRouter,
    sandboxImport: sandboxImportRouter,
    commands: commandsRouter,
    voice: voiceRouter,
    plugins: pluginsRouter,
    permissions: permissionsRouter,
    futureStages: futureStagesRouter,
    speech: speechRouter,
    appControl: appControlRouter,
    automations: automationsRouter,
    modelProviders: modelProvidersRouter,
    opencode: opencodeRouter,
    projectVaults: projectVaultsRouter,
    usage: usageRouter,
    importExport: importExportRouter,
    hooksManagement: hooksManagementRouter,
    spawnedAgents: spawnedAgentsRouter,
    providerExtensions: providerExtensionsRouter,
    providerCapabilities: providerCapabilitiesRouter,
    credentials: credentialsRouter,
    planSources: planSourcesRouter,
    localModels: localModelsRouter,
    taskProposals: taskProposalsRouter,
    agentRuntimeDefaults: agentRuntimeDefaultsRouter,
    agentActivity: agentActivityRouter,
    agentRuntimeChat: agentRuntimeChatRouter,
    savedWorkspaces: savedWorkspacesRouter,
    coordinationEngines: coordinationEnginesRouter,
    orchestrationOperations: orchestrationOperationsRouter,
    agentProfiles: agentProfilesRouter,
    agentPersonalities: agentPersonalitiesRouter,
    betaFeatures: betaFeaturesRouter,
    visualCapture: visualCaptureRouter,
    mobileBridge: mobileBridgeRouter,
    featureVisibility: createFeatureVisibilityRouter({
      path: join(app.getPath("userData"), "data", "feature-visibility.json"),
      freshProfilePreset:
        process.env.FLAPSTACK_STAGE6_PERFORMANCE_PROFILE === "1" ? "standard" : undefined,
      broadcast: (snapshot) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(FEATURE_VISIBILITY_CHANGED_EVENT, snapshot)
          }
        }
      },
    }),
    ...(devRuntimeActivityFixturesEnabled
      ? { devRuntimeActivityFixtures: devRuntimeActivityFixturesRouter }
      : {}),
    ...(devTestControlEnabled ? { devMcpTestControl: devMcpTestControlRouter } : {}),
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
