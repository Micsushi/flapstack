import type { ReactNode } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { trpc } from "../../lib/trpc"
import { desktopViewAtom, selectedProjectAtom } from "../agents/atoms"
import { useBetaFeatures } from "../settings/use-beta-features"
import { DiscussionsView } from "./discussions-view"
import { DiscussionAnnotationProvider } from "./discussion-annotation-provider"

export function ProjectDiscussionsView() {
  const project = useAtomValue(selectedProjectAtom)
  const navigate = useSetAtom(desktopViewAtom)
  const metadata = trpc.discussions.metadata.useQuery(undefined, {
    retry: false,
    enabled: !!project,
  })
  if (!project) return <p className="p-5 text-sm">Select a project to open its topics.</p>
  if (!metadata.data)
    return (
      <p className="p-5 text-sm" role={metadata.error ? "alert" : "status"}>
        {metadata.error?.message ?? "Loading topics…"}
      </p>
    )
  return (
    <DiscussionsView
      scope={{ projectId: project.id, chatId: null, hostId: metadata.data.hostId }}
      onOpenRecords={() => navigate("project-records")}
    />
  )
}

export function ChatDiscussionSurface({
  projectId,
  chatId,
  subChatId,
  children,
}: {
  projectId: string | null | undefined
  chatId: string
  subChatId: string
  children: ReactNode
}) {
  const beta = useBetaFeatures()
  const metadata = trpc.discussions.metadata.useQuery(undefined, {
    enabled: beta.planning && !!projectId,
    retry: false,
  })
  const scope =
    beta.planning && projectId && metadata.data
      ? { projectId, chatId, hostId: metadata.data.hostId }
      : null
  return (
    <DiscussionAnnotationProvider scope={scope} subChatId={subChatId}>
      {children}
    </DiscussionAnnotationProvider>
  )
}
