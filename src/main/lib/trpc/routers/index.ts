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
import { mobileBridgeRouter } from "./mobile-bridge"
import { taskProposalsRouter } from "./task-proposals"
import { createGitRouter } from "../../git"
import { app, BrowserWindow } from "electron"
import { basename } from "node:path"
import { isDevTestControlEnabled } from "../../mcp-test-control/lifecycle"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 */
export function createAppRouter(getWindow: () => BrowserWindow | null) {
  const devTestControlEnabled = isDevTestControlEnabled(
    !app.isPackaged,
    process.platform === "darwin" &&
      app.isPackaged &&
      basename(process.execPath) === "Flapstack Preview",
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
    mobileBridge: mobileBridgeRouter,
    taskProposals: taskProposalsRouter,
    ...(devTestControlEnabled ? { devMcpTestControl: devMcpTestControlRouter } : {}),
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
