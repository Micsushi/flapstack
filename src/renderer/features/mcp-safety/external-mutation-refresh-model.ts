import {
  mergeProductMcpRendererInvalidations,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"

type Invalidate = () => unknown | Promise<unknown>

export type ProductMcpRendererInvalidators = {
  projectsList: Invalidate
  projectsArchived: Invalidate
  tasksList: Invalidate
  tasksArchived: Invalidate
  chatsList: Invalidate
  chatsArchived: Invalidate
  chat: (id: string) => unknown | Promise<unknown>
  runsForChat: (chatId: string) => unknown | Promise<unknown>
  run: (runId: string) => unknown | Promise<unknown>
  attachmentsForChat: (chatId: string) => unknown | Promise<unknown>
  approvals: Invalidate
  audit: Invalidate
  orchestrationTask: (taskId: string) => unknown | Promise<unknown>
  chatLineage: (chatId: string) => unknown | Promise<unknown>
  projectVault: (projectId: string) => unknown | Promise<unknown>
  automations: Invalidate
}

export function createProductMcpRendererInvalidator(
  invalidators: ProductMcpRendererInvalidators,
): (event: ProductMcpRendererInvalidation) => Promise<void> {
  return async (event) => {
    const domains = new Set(event.domains)
    const pending: Array<unknown | Promise<unknown>> = []
    if (domains.has("projects")) {
      pending.push(invalidators.projectsList(), invalidators.projectsArchived())
    }
    if (domains.has("tasks")) {
      pending.push(invalidators.tasksList(), invalidators.tasksArchived())
    }
    if (domains.has("chats")) {
      pending.push(invalidators.chatsList(), invalidators.chatsArchived())
      pending.push(...(event.chatIds ?? []).map((id) => invalidators.chat(id)))
    }
    if (domains.has("runs")) {
      pending.push(...(event.chatIds ?? []).map((id) => invalidators.runsForChat(id)))
      pending.push(...(event.runIds ?? []).map((id) => invalidators.run(id)))
    }
    if (domains.has("attachments")) {
      pending.push(...(event.chatIds ?? []).map((id) => invalidators.attachmentsForChat(id)))
    }
    if (domains.has("approvals")) pending.push(invalidators.approvals())
    if (domains.has("audit")) pending.push(invalidators.audit())
    if (domains.has("orchestrations")) {
      pending.push(...(event.taskIds ?? []).map((id) => invalidators.orchestrationTask(id)))
      pending.push(...(event.chatIds ?? []).map((id) => invalidators.chatLineage(id)))
    }
    if (domains.has("vaults")) {
      pending.push(...(event.projectIds ?? []).map((id) => invalidators.projectVault(id)))
    }
    if (domains.has("automations")) pending.push(invalidators.automations())
    await Promise.all(pending)
  }
}

export function createProductMcpInvalidationCoalescer(
  flush: (event: ProductMcpRendererInvalidation) => void | Promise<void>,
  delayMs = 25,
): {
  push: (event: ProductMcpRendererInvalidation) => void
  flush: () => void
  dispose: () => void
} {
  let queued: ProductMcpRendererInvalidation[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flushQueued = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const event = mergeProductMcpRendererInvalidations(queued)
    queued = []
    if (event) void flush(event)
  }
  return {
    push(event) {
      queued.push(event)
      if (!timer) timer = setTimeout(flushQueued, delayMs)
    },
    flush: flushQueued,
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      queued = []
    },
  }
}
