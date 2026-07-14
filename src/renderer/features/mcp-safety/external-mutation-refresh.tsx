import { useEffect } from "react"
import {
  createProductMcpInvalidationCoalescer,
  createProductMcpRendererInvalidator,
} from "./external-mutation-refresh-model"
import { trpc } from "../../lib/trpc"

export function McpExternalMutationRefreshBridge() {
  const utils = trpc.useUtils()

  useEffect(() => {
    if (!window.desktopApi?.onProductMcpInvalidation) return
    const invalidate = createProductMcpRendererInvalidator({
      projectsList: () => utils.projects.list.invalidate(),
      projectsArchived: () => utils.projects.listArchived.invalidate(),
      tasksList: () => Promise.all([utils.tasks.list.invalidate(), utils.tasks.board.invalidate()]),
      tasksArchived: () => utils.tasks.listArchived.invalidate(),
      task: (id) => utils.tasks.get.invalidate({ id }),
      chatsList: () => utils.chats.list.invalidate(),
      chatsArchived: () => utils.chats.listArchived.invalidate(),
      chat: (id) => utils.chats.get.invalidate({ id }),
      runsForChat: (chatId) => utils.runs.listByChat.invalidate({ chatId }),
      run: (runId) => utils.runs.get.invalidate({ runId }),
      attachmentsForChat: (chatId) => utils.attachments.listByChat.invalidate({ chatId }),
      approvals: () => utils.appControl.listPendingApprovals.invalidate(),
      audit: () => utils.appControl.listAuditLog.invalidate(),
      orchestrationTask: (taskId) =>
        Promise.all([
          utils.spawnedAgents.getTaskOverview.invalidate({ taskId }),
          utils.spawnedAgents.getLineage.invalidate({ taskId }),
        ]),
      chatLineage: (chatId) => utils.spawnedAgents.previewLineage.invalidate({ chatId }),
      projectVault: () => utils.projectVaults.invalidate(),
      automations: () => utils.automations.invalidate(),
      taskProposals: () => utils.taskProposals.invalidate(),
      planSources: (projectId) =>
        projectId
          ? Promise.all([
              utils.planSources.refresh.invalidate({ projectId }),
              utils.planSources.sourceLinks.invalidate({ projectId }),
            ])
          : utils.planSources.invalidate(),
    })
    const coalescer = createProductMcpInvalidationCoalescer(invalidate)
    const unsubscribe = window.desktopApi.onProductMcpInvalidation(coalescer.push)
    return () => {
      unsubscribe()
      coalescer.dispose()
    }
  }, [utils])

  return null
}
