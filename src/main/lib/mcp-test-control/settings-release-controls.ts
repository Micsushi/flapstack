import { eq } from "drizzle-orm"
import { BrowserWindow } from "electron"
import type { CredentialId, CredentialMetadata } from "../../../shared/credential-types"
import type { ChatMode } from "../../../shared/chat-mode"
import {
  DEV_MCP_SETTINGS_INVALIDATION_CHANNEL,
  type DevMcpSettingsDomain,
} from "../../../shared/dev-renderer-control"
import type {
  CustomPermissionToggles,
  PermissionChangeBehavior,
  PermissionMode,
} from "../permissions"
import { chats, getDatabase, projects, subChats } from "../db"
import type { ProviderExtensionKind, ProviderExtensionProvider } from "../provider-extensions"
import { credentialsRouter } from "../trpc/routers/credentials"
import { permissionsRouter } from "../trpc/routers/permissions"
import { providerExtensionsRouter } from "../trpc/routers/provider-extensions"

const callerContext = { getWindow: () => null }

function notifySettingsChanged(domains: DevMcpSettingsDomain[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(DEV_MCP_SETTINGS_INVALIDATION_CHANNEL, { domains })
    }
  }
}

function projectPath(projectId: string): string {
  const project = getDatabase()
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project.path
}

export async function getCredentialStatus(input?: { id?: CredentialId }) {
  const caller = credentialsRouter.createCaller(callerContext)
  return input?.id ? [await caller.status({ id: input.id })] : caller.listStatuses()
}

export async function setOrReplaceCredential(input: {
  id: CredentialId
  secret: string
  metadata?: CredentialMetadata
}) {
  const caller = credentialsRouter.createCaller(callerContext)
  const before = await caller.status({ id: input.id })
  const status = await caller.set(input)
  notifySettingsChanged(["credentials"])
  return {
    operation: before.configured ? "replaced" : "created",
    status,
    proofBoundary:
      "Write-only input; response contains credential status and fingerprint, never plaintext.",
  }
}

export async function migrateLegacyCredential(input: {
  id: CredentialId
  legacyKey: "onboarding:codex-api-key" | "agents:openai-api-key" | "agents:claude-custom-config"
  secret: string
  expectedFingerprint: string
  metadata?: CredentialMetadata
}) {
  const status = await credentialsRouter.createCaller(callerContext).migrateLegacy(input)
  notifySettingsChanged(["credentials"])
  return {
    status,
    proofBoundary:
      "Main-process migration acknowledgement only; the caller must clear its legacy renderer source only when acknowledged is true.",
  }
}

export async function removeCredential(input: { id: CredentialId }) {
  const status = await credentialsRouter.createCaller(callerContext).remove(input)
  notifySettingsChanged(["credentials"])
  return { status, proofBoundary: "Removal result contains status only, never plaintext." }
}

export async function listRegisteredProviderExtensions(input?: { projectId?: string }) {
  const cwd = input?.projectId ? projectPath(input.projectId) : undefined
  const items = await providerExtensionsRouter.createCaller(callerContext).list({ cwd })
  const counts = items.reduce<Record<string, number>>((result, item) => {
    const key = `${item.provider}:${item.kind}:${item.source}`
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
  return {
    projectId: input?.projectId ?? null,
    total: items.length,
    counts,
    items: items.map(({ content: _content, ...item }) => item),
    proofBoundary:
      "Project scope resolves from a persisted project ID and the registered-root guard; content is omitted.",
  }
}

export async function mutateRegisteredProjectProviderExtension(input: {
  operation: "create" | "update" | "delete"
  provider: ProviderExtensionProvider
  kind: ProviderExtensionKind
  projectId: string
  sourceId?: string
  name: string
  description?: string
  content?: string
}) {
  const cwd = projectPath(input.projectId)
  const result = await providerExtensionsRouter.createCaller(callerContext).mutate({
    operation: input.operation,
    provider: input.provider,
    kind: input.kind,
    source: "project",
    cwd,
    sourceId: input.sourceId,
    name: input.name,
    description: input.description ?? "",
    content: input.content ?? "",
  })
  notifySettingsChanged(["provider-extensions"])
  return {
    ...result,
    projectId: input.projectId,
    proofBoundary:
      "Mutation was rooted through the persisted project ID and registered-root guard.",
  }
}

export async function getPermissionState(input?: { chatId?: string }) {
  const caller = permissionsRouter.createCaller(callerContext)
  const preferences = await caller.getPreferences()
  if (!input?.chatId) return { preferences, chat: null }
  return { preferences, chat: await caller.resolveForChat({ chatId: input.chatId }) }
}

export async function setPermissionDefault(input: {
  mode: PermissionMode
  customPermissions?: CustomPermissionToggles
}) {
  const result = await permissionsRouter.createCaller(callerContext).setGlobalDefault(input)
  notifySettingsChanged(["permissions"])
  return result
}

export async function setPermissionChangeBehavior(input: { behavior: PermissionChangeBehavior }) {
  const result = await permissionsRouter.createCaller(callerContext).setChangeBehavior(input)
  notifySettingsChanged(["permissions"])
  return result
}

export async function setChatPermission(input: {
  chatId: string
  mode: PermissionMode
  scope?: "all-chats" | "current-chat"
  rememberBehavior?: PermissionChangeBehavior
  customPermissions?: CustomPermissionToggles
}) {
  const result = await permissionsRouter.createCaller(callerContext).setChatMode(input)
  notifySettingsChanged(["permissions"])
  return result
}

export async function previewPermission(input: {
  harness: "claude-code" | "codex" | "cursor-agent" | "openrouter" | "nanogpt"
  mode: PermissionMode
  chatMode?: ChatMode
  chatId?: string
  customPermissions?: CustomPermissionToggles
}) {
  const caller = permissionsRouter.createCaller(callerContext)
  let cwd: string | null = null
  let customPermissions = input.customPermissions
  if (input.chatId) {
    const chat = getDatabase()
      .select({ worktreePath: chats.worktreePath, projectId: chats.projectId })
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get()
    if (!chat) throw new Error(`Chat not found: ${input.chatId}`)
    cwd = chat.worktreePath ?? (chat.projectId ? projectPath(chat.projectId) : null)
    if (input.mode === "custom" && !customPermissions) {
      customPermissions =
        (await caller.resolveForChat({ chatId: input.chatId })).customPermissions ?? undefined
    }
  }
  if (input.mode === "custom" && !customPermissions) {
    throw new Error("Custom permission preview requires explicit or stored capability toggles.")
  }
  return caller.previewHarness({
    harness: input.harness,
    mode: input.mode,
    chatMode: input.chatMode,
    cwd,
    customPermissions,
  })
}

export function resolveTestChatSelection(input: { chatId: string; subChatId: string }) {
  const chat = getDatabase()
    .select({
      id: chats.id,
      projectId: chats.projectId,
      archivedAt: chats.archivedAt,
    })
    .from(chats)
    .where(eq(chats.id, input.chatId))
    .get()
  if (!chat || chat.archivedAt) throw new Error("Active test chat not found")
  if (!chat.projectId) throw new Error("Test chat is not project-scoped")
  const subChat = getDatabase()
    .select({ id: subChats.id, chatId: subChats.chatId })
    .from(subChats)
    .where(eq(subChats.id, input.subChatId))
    .get()
  if (!subChat || subChat.chatId !== chat.id) {
    throw new Error("Sub-chat does not belong to the requested test chat")
  }
  const project = getDatabase()
    .select({ id: projects.id, name: projects.name, path: projects.path })
    .from(projects)
    .where(eq(projects.id, chat.projectId))
    .get()
  if (!project) throw new Error("Project not found")
  return { chatId: chat.id, subChatId: subChat.id, project }
}
