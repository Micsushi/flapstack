import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { streamReplySpeech } from "../../lib/reply-speech-stream"
import { stopManagedSpeech } from "../../lib/speech-playback"
import {
  createProjectVaultQueryInvalidator,
  createProductMcpInvalidationCoalescer,
  createProductMcpRendererInvalidator,
} from "./external-mutation-refresh-model"
import { trpc, trpcClient } from "../../lib/trpc"

export function McpExternalMutationRefreshBridge() {
  const utils = trpc.useUtils()
  const playback = useRef<ReturnType<typeof streamReplySpeech> | null>(null)
  trpc.speech.playbackCommands.useSubscription(undefined, {
    enabled: Boolean(window.desktopApi),
    onData(command) {
      if (command.kind === "stop") {
        if (command.requestedOnly && !playback.current) return
        stopManagedSpeech()
        void trpcClient.speech.stopSpeaking
          .mutate()
          .catch((error) => toast.error("Could not stop speech", { description: error.message }))
        return
      }
      playback.current = streamReplySpeech(command, {
        startTime: 0,
        getRate: () => command.rate,
        onText() {},
        onProgress() {},
        onPlaying() {},
        onFinish() {
          playback.current = null
        },
        onError(error) {
          toast.error("Could not play reply", { description: error.message })
        },
        onHistoryError(error) {
          toast.warning("Could not save reply audio", { description: error })
        },
      })
    },
  })
  useEffect(() => () => playback.current?.stop(), [])

  useEffect(() => {
    if (!window.desktopApi?.onProductMcpInvalidation) return
    const invalidate = createProductMcpRendererInvalidator({
      projectsList: () => utils.projects.list.invalidate(),
      projectsArchived: () =>
        Promise.all([
          utils.projects.listArchived.invalidate(),
          utils.chats.archiveSummary.invalidate(),
        ]),
      tasksList: () => Promise.all([utils.tasks.list.invalidate(), utils.tasks.board.invalidate()]),
      tasksArchived: () =>
        Promise.all([
          utils.tasks.listArchived.invalidate(),
          utils.chats.archiveSummary.invalidate(),
        ]),
      task: (id) => utils.tasks.get.invalidate({ id }),
      chatsList: () => utils.chats.list.invalidate(),
      chatsArchived: () =>
        Promise.all([
          utils.chats.listArchived.invalidate(),
          utils.chats.archiveSummary.invalidate(),
        ]),
      chat: (id) =>
        Promise.all([
          utils.chats.get.invalidate({ id }),
          utils.chats.getMetadata.invalidate({ id }),
          utils.chats.getTranscript.invalidate({ chatId: id }),
          utils.diffAnnotations.list.invalidate({ chatId: id }),
        ]),
      runsForChat: (chatId) => utils.runs.listByChat.invalidate({ chatId }),
      run: (runId) => utils.runs.get.invalidate({ runId }),
      attachmentsForChat: (chatId) => utils.attachments.listByChat.invalidate({ chatId }),
      approvals: () => utils.appControl.listPendingApprovals.invalidate(),
      audit: () => utils.appControl.listAuditLog.invalidate(),
      orchestrationTask: (taskId) =>
        Promise.all([
          utils.spawnedAgents.getTaskOverview.invalidate({ taskId }),
          utils.spawnedAgents.getLineage.invalidate({ taskId }),
          utils.savedWorkspaces.getOperation.invalidate(),
        ]),
      chatLineage: (chatId) => utils.spawnedAgents.previewLineage.invalidate({ chatId }),
      projectVault: createProjectVaultQueryInvalidator({
        graph: ({ projectId }) => utils.projectVaults.getGraph.invalidate({ projectId }),
        notes: () => utils.projectVaults.readNote.invalidate(),
        project: ({ projectId }) =>
          Promise.all([
            utils.projectVaults.listSections.invalidate({ projectId }),
            utils.projectVaults.readSection.invalidate({ projectId }),
            utils.projectVaults.listBackups.invalidate({ projectId }),
            utils.projectVaults.readBackup.invalidate({ projectId }),
            utils.projectVaults.search.invalidate({ projectId }),
          ]),
        list: (input) => utils.projectVaults.listSections.invalidate(input),
        get: (input) => utils.projectVaults.readSection.invalidate(input),
        backups: (input) => utils.projectVaults.listBackups.invalidate(input),
        backup: (input) => utils.projectVaults.readBackup.invalidate(input),
        search: (input) => utils.projectVaults.search.invalidate(input),
      }),
      automations: () => utils.automations.invalidate(),
      taskProposals: () => utils.taskProposals.invalidate(),
      planSources: (projectId) =>
        projectId
          ? Promise.all([
              utils.planSources.refresh.invalidate({ projectId }),
              utils.planSources.sourceLinks.invalidate({ projectId }),
            ])
          : utils.planSources.invalidate(),
      speech: () => utils.speech.getSettings.invalidate(),
      chatWorkflows: () =>
        Promise.all([
          utils.chats.listTags.invalidate(),
          utils.chats.listTagAssignments.invalidate(),
          utils.chats.getParsedDiff.invalidate(),
          utils.agentProfiles.getChatBinding.invalidate(),
          utils.sideQuestions.list.invalidate(),
          utils.runs.getChangeSet.invalidate(),
        ]),
      providerExtensions: () => utils.providerExtensions.invalidate(),
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
