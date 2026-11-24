import type { ReasoningEffort } from "./model-catalog"

export type AntigravityModelOption = {
  id: string
  name: string
  nativeEfforts?: { value: ReasoningEffort; name: string }[]
  defaultEffort?: string
}

// ACP selects effort by sending a distinct provider-advertised model ID.
export function antigravityEffortVariants(
  models: readonly AntigravityModelOption[],
  selectedId: string | null | undefined,
) {
  const pattern = /^(.*) \((minimal|none|low|medium|high|xhigh|max|ultra)\)$/i
  const selected = models.find((model) => model.id === selectedId)
  const family = selected && pattern.exec(selected.name)
  const efforts = family
    ? models.flatMap((model) => {
        const match = pattern.exec(model.name)
        return match && match[1] === family[1]
          ? [{ id: model.id, label: match[2]!.toLowerCase() }]
          : []
      })
    : []
  return { selectedEffort: family?.[2]?.toLowerCase(), efforts }
}
