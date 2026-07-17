import type { SelectedChatScope } from "../agents/atoms"

export function resolveSectionHeaderScopeSelection({
  isProjectSection,
  hasOpenChats,
  willExpand,
  scope,
}: {
  isProjectSection: boolean
  hasOpenChats: boolean
  willExpand: boolean
  scope: SelectedChatScope
}): SelectedChatScope | undefined {
  if (isProjectSection) return hasOpenChats ? undefined : scope
  return willExpand ? scope : null
}
