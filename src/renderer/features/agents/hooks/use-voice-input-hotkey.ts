import { useAtomValue } from "jotai"
import { useEffect } from "react"

import { customHotkeysAtom } from "../../../lib/atoms"
import { getResolvedHotkey } from "../../../lib/hotkeys"

const MODIFIER_NAMES = ["cmd", "meta", "ctrl", "opt", "alt", "shift"]

interface VoiceInputHotkeyOptions {
  enabled?: boolean
  isRecording: boolean
  isStarting: boolean
  isTranscribing: boolean
  ownsDictation: boolean
  onStart: () => void
  onStop: () => void
}

export function useVoiceInputHotkey({
  enabled = true,
  isRecording,
  isStarting,
  isTranscribing,
  ownsDictation,
  onStart,
  onStop,
}: VoiceInputHotkeyOptions): void {
  const customHotkeys = useAtomValue(customHotkeysAtom)
  const voiceHotkey = getResolvedHotkey("voice-input", customHotkeys)

  useEffect(() => {
    if (!enabled || !voiceHotkey) return

    const parts = voiceHotkey.split("+").map((part) => part.toLowerCase())
    const modifiers = parts.filter((part) => MODIFIER_NAMES.includes(part))
    const mainKey = parts.find((part) => !MODIFIER_NAMES.includes(part))
    const needsCmd = modifiers.includes("cmd") || modifiers.includes("meta")
    const needsShift = modifiers.includes("shift")
    const needsCtrl = modifiers.includes("ctrl")
    const needsAlt = modifiers.includes("alt") || modifiers.includes("opt")
    const isModifierOnlyHotkey = !mainKey

    const modifiersMatch = (event: KeyboardEvent) =>
      event.metaKey === needsCmd &&
      event.shiftKey === needsShift &&
      event.ctrlKey === needsCtrl &&
      event.altKey === needsAlt

    const mainKeyMatches = (event: KeyboardEvent) => {
      if (!mainKey) return false
      const eventCode = event.code.toLowerCase()
      return (
        event.key.toLowerCase() === mainKey ||
        eventCode === mainKey ||
        eventCode === `key${mainKey}` ||
        (mainKey === "space" && event.code === "Space")
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const matches = isModifierOnlyHotkey
        ? modifiersMatch(event)
        : mainKeyMatches(event) && modifiersMatch(event)
      if (!matches || event.repeat) return

      event.preventDefault()
      event.stopPropagation()
      if (!isStarting && !isRecording && !isTranscribing) onStart()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isModifierRelease = ["control", "alt", "meta", "shift"].includes(key)
      const isRelease = isModifierOnlyHotkey ? isModifierRelease : mainKeyMatches(event)
      if (!isRelease || !ownsDictation || (!isStarting && !isRecording)) return

      event.preventDefault()
      event.stopPropagation()
      onStop()
    }

    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
    }
  }, [
    enabled,
    isRecording,
    isStarting,
    isTranscribing,
    onStart,
    onStop,
    ownsDictation,
    voiceHotkey,
  ])
}
