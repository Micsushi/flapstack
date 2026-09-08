import { useCallback, useRef, useState } from "react"
import type {
  DiscussionChange,
  DiscussionScope,
  DiscussionTopic,
} from "../../../shared/discussions"
import { recordAppAction } from "../../lib/app-action-history"
import { trpc, trpcClient } from "../../lib/trpc"

export function useDiscussions(scope: DiscussionScope) {
  const query = trpc.discussions.list.useInfiniteQuery(
    { scope, limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined, refetchOnWindowFocus: true },
  )
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const refresh = useCallback(() => utils.discussions.list.invalidate({ scope }), [utils, scope])
  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      await refresh()
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Your draft is retained.")
      await refresh()
      return undefined
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const change = (topic: DiscussionTopic, change: DiscussionChange) =>
    run(async () => {
      const next = await trpcClient.discussions.update.mutate({
        scope,
        id: topic.id,
        expectedRevision: topic.revision,
        change,
      })
      if (change.type !== "draft") {
        let revision = next.revision
        const restore = async (targetRevision: number) => {
          const restored = await trpcClient.discussions.restore.mutate({
            scope,
            id: topic.id,
            expectedRevision: revision,
            targetRevision,
          })
          revision = restored.revision
          await refresh()
        }
        recordAppAction({
          label: `Change topic: ${topic.title}`,
          undo: () => restore(topic.revision),
          redo: () => restore(next.revision),
        })
      }
      return next
    })
  const create = (title: string, body: string, kind: "fix" | "idea" | "note") =>
    run(async () => {
      const topic = await trpcClient.discussions.create.mutate({
        scope,
        title,
        capture: { body, kind },
      })
      let revision = topic.revision
      const archive = async (archived: boolean) => {
        const next = await trpcClient.discussions.update.mutate({
          scope,
          id: topic.id,
          expectedRevision: revision,
          change: { type: "archive", archived },
        })
        revision = next.revision
        await refresh()
      }
      recordAppAction({
        label: `Capture topic: ${title}`,
        undo: () => archive(true),
        redo: () => archive(false),
      })
      return topic
    })
  const captureMixed = (body: string, title?: string) =>
    run(async () => {
      const result = await trpcClient.discussions.captureMixed.mutate({ scope, body, title })
      let undo = result.undo
      const restore = async () => {
        const restored = await trpcClient.discussions.restoreMixed.mutate(undo)
        undo = restored.undo
        await refresh()
      }
      recordAppAction({ label: "Capture and group thoughts", undo: restore, redo: restore })
      return result
    })
  return {
    captureMixed,
    topics: query.data?.pages.flatMap((page) => page.topics) ?? [],
    loadMore: () => query.fetchNextPage(),
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loading: query.isLoading,
    error: error ?? query.error?.message,
    busy,
    change,
    create,
    refresh,
  }
}

// Drafts survive navigation and renderer restarts; topic records remain server-owned.
function matchesDraftShape(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback))
    return Array.isArray(value) && value.every((item) => typeof item === "string")
  if (fallback !== null && typeof fallback === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false
    return Object.entries(fallback).every(([key, sample]) =>
      matchesDraftShape((value as Record<string, unknown>)[key], sample),
    )
  }
  return typeof value === typeof fallback
}
export function useDiscussionDraft<T>(key: string, fallback: T) {
  const [state, setState] = useState<{ value: T; storageError: boolean }>(() => {
    try {
      const saved = window.localStorage.getItem(key)
      if (!saved) return { value: fallback, storageError: false }
      const value: unknown = JSON.parse(saved)
      if (matchesDraftShape(value, fallback)) return { value: value as T, storageError: false }
    } catch {
      /* Keep the original stored draft available for recovery. */
    }
    return { value: fallback, storageError: true }
  })
  const save = (next: T | ((current: T) => T)) => {
    setState((current) => {
      const value = typeof next === "function" ? (next as (value: T) => T)(current.value) : next
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return { value, storageError: false }
      } catch {
        return { value, storageError: true }
      }
    })
  }
  return [state.value, save, state.storageError] as const
}
export function discussionDraftKey(scope: DiscussionScope, id: string) {
  return `flapstack.discussion-draft:${JSON.stringify([scope.hostId, scope.projectId, scope.chatId, id])}`
}
