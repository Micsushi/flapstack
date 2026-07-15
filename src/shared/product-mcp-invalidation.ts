import type { McpControlResponse } from "../main/lib/mcp-control/types"

export const PRODUCT_MCP_INVALIDATION_CHANNEL = "product-mcp:renderer-invalidation"
export const PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV = "FLAPSTACK_PRODUCT_MCP_INVALIDATION_ENDPOINT"

export const productMcpInvalidationDomains = [
  "projects",
  "tasks",
  "chats",
  "runs",
  "attachments",
  "approvals",
  "audit",
  "orchestrations",
  "vaults",
  "automations",
  "task-proposals",
  "plan-sources",
  "provider-extensions",
] as const

export type ProductMcpInvalidationDomain = (typeof productMcpInvalidationDomains)[number]

export const projectVaultChangeKinds = [
  "section-saved",
  "conflict-resolved",
  "backup-restored",
  "external-change-adopted",
] as const

export type ProjectVaultChangeKind = (typeof projectVaultChangeKinds)[number]

export const projectVaultInvalidationSectionIds = [
  "index",
  "handoff",
  "decisions",
  "context",
  "tasks",
  "logs",
] as const

export type ProjectVaultInvalidationSectionId = (typeof projectVaultInvalidationSectionIds)[number]

export type ProjectVaultRendererChange = {
  projectId: string
  sectionId: ProjectVaultInvalidationSectionId
  revision: number
  kind: ProjectVaultChangeKind
}

export type ProductMcpRendererInvalidation = {
  version: 1
  source: "product-mcp"
  domains: ProductMcpInvalidationDomain[]
  chatIds?: string[]
  runIds?: string[]
  projectIds?: string[]
  taskIds?: string[]
  automationIds?: string[]
  proposalIds?: string[]
  vaultChanges?: ProjectVaultRendererChange[]
}

const allowedKeys = new Set([
  "version",
  "source",
  "domains",
  "chatIds",
  "runIds",
  "projectIds",
  "taskIds",
  "automationIds",
  "proposalIds",
  "vaultChanges",
])
const domains = new Set<string>(productMcpInvalidationDomains)
const vaultChangeKinds = new Set<string>(projectVaultChangeKinds)
const vaultSectionIds = new Set<string>(projectVaultInvalidationSectionIds)
const vaultChangeKeys = new Set(["projectId", "sectionId", "revision", "kind"])

/** Strictly copy the product event allowlist. Unknown fields are rejected. */
export function parseProductMcpRendererInvalidation(
  value: unknown,
): ProductMcpRendererInvalidation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null
  if (record.version !== 1 || record.source !== "product-mcp") return null
  if (!Array.isArray(record.domains) || record.domains.length === 0) return null
  if (!record.domains.every((domain) => typeof domain === "string" && domains.has(domain))) {
    return null
  }

  const event: ProductMcpRendererInvalidation = {
    version: 1,
    source: "product-mcp",
    domains: unique(record.domains as ProductMcpInvalidationDomain[]),
  }
  for (const key of [
    "chatIds",
    "runIds",
    "projectIds",
    "taskIds",
    "automationIds",
    "proposalIds",
  ] as const) {
    const ids = record[key]
    if (ids === undefined) continue
    if (!isBoundedIds(ids)) return null
    event[key] = unique(ids)
  }
  if (record.vaultChanges !== undefined) {
    if (!event.domains.includes("vaults") || !isBoundedVaultChanges(record.vaultChanges))
      return null
    event.vaultChanges = uniqueBy(record.vaultChanges, (change) => JSON.stringify(change))
  }
  return event
}

export function mergeProductMcpRendererInvalidations(
  events: readonly ProductMcpRendererInvalidation[],
): ProductMcpRendererInvalidation | null {
  if (events.length === 0) return null
  const merged: ProductMcpRendererInvalidation = {
    version: 1,
    source: "product-mcp",
    domains: unique(events.flatMap((event) => event.domains)),
  }
  for (const key of [
    "chatIds",
    "runIds",
    "projectIds",
    "taskIds",
    "automationIds",
    "proposalIds",
  ] as const) {
    const ids = unique(events.flatMap((event) => event[key] ?? []))
    if (ids.length > 0) merged[key] = ids
  }
  const vaultChanges = uniqueBy(
    events.flatMap((event) => event.vaultChanges ?? []),
    (change) => JSON.stringify(change),
  )
  if (vaultChanges.length > 0) merged.vaultChanges = vaultChanges
  return merged
}

export function invalidationForProjectVaultChange(
  change: ProjectVaultRendererChange,
): ProductMcpRendererInvalidation {
  const event = parseProductMcpRendererInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["vaults"],
    vaultChanges: [change],
  })
  if (!event) throw new Error("Project vault invalidation payload is invalid.")
  return event
}

/** Map successful durable product mutations to the smallest renderer refresh set. */
export function invalidationForProductMcpMutation(
  operation: string,
  input: unknown,
  response: McpControlResponse,
): ProductMcpRendererInvalidation | null {
  if (!response.ok || !responseChanged(response.data)) return null
  const request = objectValue(input)
  const result = objectValue(response.data)
  const resultId = stringValue(result.id)
  const inputId = stringValue(request.id)
  const chatId = stringValue(request.chatId) ?? stringValue(result.chatId)

  switch (operation) {
    case "create_vault_section":
    case "update_vault_section":
    case "update_vault_handoff":
    case "record_vault_decision":
      return event(["vaults"], {
        projectIds: compactIds(stringValue(request.projectId), stringValue(result.projectId)),
      })
    case "create_automation_draft":
    case "update_automation":
    case "enable_automation":
      return event(["automations"], {
        automationIds: compactIds(
          stringValue(request.automationId),
          stringValue(result.id),
          stringValue(objectValue(result.record).id),
        ),
      })
    case "propose_task":
    case "update_task_proposal":
    case "cancel_task_proposal":
      return event(["task-proposals", "plan-sources"], {
        proposalIds: compactIds(
          stringValue(request.proposalId),
          stringValue(result.id),
          stringValue(objectValue(result.record).id),
        ),
        projectIds: compactIds(
          stringValue(objectValue(request.proposal).projectId),
          stringValue(objectValue(result.record).projectId),
        ),
      })
    case "create_chat":
    case "spawn_thread":
      return event(["chats"], {
        chatIds: compactIds(resultId, stringValue(result.childChatId), chatId),
      })
    case "create_task":
      return event(["tasks"], { taskIds: compactIds(resultId) })
    case "orchestrate_task": {
      const orchestration = objectValue(result.orchestration)
      const taskId = stringValue(orchestration.taskId)
      const agents = Array.isArray(result.agents) ? result.agents.map(objectValue) : []
      return event(["tasks", "chats", "runs", "orchestrations"], {
        taskIds: compactIds(taskId),
        chatIds: compactIds(
          stringValue(orchestration.initiatingChatId),
          ...agents.map((agent) => stringValue(agent.chatId)),
        ),
        runIds: compactIds(...agents.map((agent) => stringValue(agent.runId))),
      })
    }
    case "add_attachment":
      return event(["attachments"], { chatIds: compactIds(chatId) })
    case "launch_run":
      return event(["runs", "chats"], {
        chatIds: compactIds(chatId),
        runIds: compactIds(stringValue(result.runId)),
      })
    case "move_chat":
      return event(["chats"], { chatIds: compactIds(inputId, resultId) })
    case "rename_item":
    case "pin_item":
    case "archive_item":
    case "restore_item": {
      const kind = request.kind
      if (kind === "project")
        return event(["projects", "tasks", "chats"], {
          projectIds: compactIds(inputId, resultId),
        })
      if (kind === "task")
        return event(["tasks", "chats"], { taskIds: compactIds(inputId, resultId) })
      if (kind === "chat") return event(["chats"], { chatIds: compactIds(inputId, resultId) })
      return null
    }
    default:
      return null
  }
}

function event(
  eventDomains: ProductMcpInvalidationDomain[],
  ids: Pick<
    ProductMcpRendererInvalidation,
    "chatIds" | "runIds" | "projectIds" | "taskIds" | "automationIds" | "proposalIds"
  >,
): ProductMcpRendererInvalidation {
  return parseProductMcpRendererInvalidation({
    version: 1,
    source: "product-mcp",
    domains: eventDomains,
    ...Object.fromEntries(Object.entries(ids).filter(([, value]) => value && value.length > 0)),
  })!
}

function responseChanged(value: unknown): boolean {
  const result = objectValue(value)
  if (result.changed === false || result.created === false) return false
  return true
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function compactIds(...values: Array<string | undefined>): string[] {
  return unique(values.filter((value): value is string => Boolean(value)))
}

function isBoundedIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)
  )
}

function isBoundedVaultChanges(value: unknown): value is ProjectVaultRendererChange[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
      const change = entry as Record<string, unknown>
      return (
        !Object.keys(change).some((key) => !vaultChangeKeys.has(key)) &&
        typeof change.projectId === "string" &&
        change.projectId.length > 0 &&
        change.projectId.length <= 256 &&
        typeof change.sectionId === "string" &&
        vaultSectionIds.has(change.sectionId) &&
        Number.isSafeInteger(change.revision) &&
        (change.revision as number) > 0 &&
        typeof change.kind === "string" &&
        vaultChangeKinds.has(change.kind)
      )
    })
  )
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const identity = key(value)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}
