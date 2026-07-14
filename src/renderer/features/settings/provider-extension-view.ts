import type { ProviderExtensionManifest } from "../../../main/lib/provider-extensions"

export type ProviderExtensionFilterProvider = "all" | ProviderExtensionManifest["provider"]

export function filterProviderExtensions(
  inventory: ProviderExtensionManifest[],
  options: {
    provider: ProviderExtensionFilterProvider
    kind: ProviderExtensionManifest["kind"]
    query: string
  },
): ProviderExtensionManifest[] {
  const needle = options.query.trim().toLowerCase()
  return inventory.filter((item) => {
    if (options.provider !== "all" && item.provider !== options.provider) return false
    if (item.kind !== options.kind) return false
    return (
      !needle ||
      item.name.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      item.path.toLowerCase().includes(needle)
    )
  })
}

export function isProviderExtensionWritable(item: ProviderExtensionManifest): boolean {
  return (
    item.capabilities.update &&
    item.capabilities.runtime !== "read-only" &&
    item.capabilities.runtime !== "unknown"
  )
}
