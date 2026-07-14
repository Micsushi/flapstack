import { useAtomValue } from "jotai"
import { customHotkeysAtom } from "../atoms"
import {
  getResolvedHotkey,
  hotkeyToDisplay,
  getShortcutAction,
  keysToDisplay,
  keysToHotkeyString,
  migrateHotkeysConfig,
} from "./shortcut-registry"
import type { ShortcutActionId } from "./types"

/**
 * Hook to get the display string for a resolved hotkey.
 * Respects custom user bindings from customHotkeysAtom.
 *
 * @param actionId - The shortcut action ID from the registry
 * @returns Display string (e.g., "⌘⇧N") or null if action doesn't exist
 *
 * @example
 * const toggleSidebarHotkey = useResolvedHotkeyDisplay("toggle-sidebar")
 * // Returns "⌘\" by default, or custom binding if set
 */
export function useResolvedHotkeyDisplay(actionId: ShortcutActionId): string | null {
  const config = useAtomValue(customHotkeysAtom)
  const safeConfig = migrateHotkeysConfig(config)
  const hotkey = getResolvedHotkey(actionId, safeConfig)
  if (!hotkey) return null
  return hotkeyToDisplay(hotkey)
}

/**
 * Hook to get both primary and alternative display strings for a resolved hotkey.
 * Useful for actions with altKeys (e.g., stop-generation: Esc or Ctrl+C)
 *
 * @param actionId - The shortcut action ID from the registry
 * @returns Object with primary and alt display strings, or null values if not found
 */
export function useResolvedHotkeyDisplayWithAlt(actionId: ShortcutActionId): {
  primary: string | null
  alt: string | null
} {
  const config = useAtomValue(customHotkeysAtom)
  const safeConfig = migrateHotkeysConfig(config)
  const hotkey = getResolvedHotkey(actionId, safeConfig)
  const action = getShortcutAction(actionId)

  const primary = hotkey ? hotkeyToDisplay(hotkey) : null

  // Only show alt if not using custom binding
  const hasCustomBinding = safeConfig.bindings[actionId] !== undefined
  const alt =
    action?.altKeys && !hasCustomBinding
      ? hotkeyToDisplay(keysToHotkeyString(action.altKeys))
      : null

  return { primary, alt }
}
