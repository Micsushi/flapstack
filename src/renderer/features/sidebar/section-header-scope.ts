import type { SelectedChatScope } from "../agents/atoms"

export function resolveSectionHeaderScopeSelection({
  isProjectSection,
  isGlobalSection = false,
  hasOpenChats,
  willExpand,
  scope,
}: {
  isProjectSection: boolean
  isGlobalSection?: boolean
  hasOpenChats: boolean
  willExpand: boolean
  scope: SelectedChatScope
}): SelectedChatScope | undefined {
  if (isGlobalSection) return undefined
  if (isProjectSection) return hasOpenChats ? undefined : scope
  return willExpand ? scope : null
}
