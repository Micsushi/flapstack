export const LOCAL_DICTATION_PRIVACY_NOTE =
  "Audio stays on this device. No cloud transcription fallback is used."

type LocalAdapterAvailability = {
  adapterId: string
  available: boolean
  canAutoProvision?: boolean
  reason?: string
  missingDependency?: "engine" | "audio-converter" | "model"
}

export type LocalDictationAvailability = {
  available: boolean
  method?: string | null
  reason?: string
  adapters?: readonly LocalAdapterAvailability[]
}

export type LocalDictationModelStatus =
  | { status: "absent" }
  | { status: "downloading"; percent: number }
  | { status: "present"; sizeBytes: number }
  | { status: "error"; message: string }

export type LocalDictationReadiness = {
  kind: "checking" | "needs-engine" | "needs-model" | "downloading" | "error" | "ready"
  ready: boolean
  title: string
  description: string
  action: "wait" | "open-settings" | "download" | "retry" | "record"
  percent?: number
}

export function getLocalDictationReadiness(
  availability?: LocalDictationAvailability,
  modelStatus?: LocalDictationModelStatus,
): LocalDictationReadiness {
  const localAdapter = availability?.adapters?.find(
    (adapter) => adapter.adapterId === "local-whisper",
  )

  if (!availability || !localAdapter) {
    return {
      kind: "checking",
      ready: false,
      title: "Checking local dictation",
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "wait",
    }
  }

  if (localAdapter.available) {
    return {
      kind: "ready",
      ready: true,
      title: "Local dictation ready",
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "record",
    }
  }

  if (localAdapter.missingDependency === "engine") {
    return {
      kind: "needs-engine",
      ready: false,
      title: "Local dictation needs whisper.cpp",
      description: `Install whisper.cpp and set the whisper-cli path in Voice settings. ${LOCAL_DICTATION_PRIVACY_NOTE}`,
      action: "open-settings",
    }
  }

  if (localAdapter.missingDependency === "audio-converter") {
    return {
      kind: "needs-engine",
      ready: false,
      title: "Local dictation needs ffmpeg",
      description: `Install ffmpeg so browser-recorded audio can be converted locally. ${LOCAL_DICTATION_PRIVACY_NOTE}`,
      action: "open-settings",
    }
  }

  if (!localAdapter.canAutoProvision) {
    return {
      kind: "needs-engine",
      ready: false,
      title: "Local dictation tools are not ready",
      description: `Open Voice settings to configure the missing local tools. ${LOCAL_DICTATION_PRIVACY_NOTE}`,
      action: "open-settings",
    }
  }

  if (!modelStatus) {
    return {
      kind: "checking",
      ready: false,
      title: "Checking Local Whisper model",
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "wait",
    }
  }

  if (modelStatus.status === "present") {
    return {
      kind: "ready",
      ready: true,
      title: "Local dictation ready",
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "record",
    }
  }

  if (modelStatus.status === "downloading") {
    return {
      kind: "downloading",
      ready: false,
      title: `Downloading Local Whisper model (${modelStatus.percent}%)`,
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "wait",
      percent: modelStatus.percent,
    }
  }

  if (modelStatus.status === "error") {
    return {
      kind: "error",
      ready: false,
      title: "Local Whisper model download failed",
      description: `${modelStatus.message} ${LOCAL_DICTATION_PRIVACY_NOTE}`,
      action: "retry",
    }
  }

  return {
    kind: "needs-model",
    ready: false,
    title: "Local dictation needs a model",
    description: `Download the Local Whisper base model once (about 150 MB). ${LOCAL_DICTATION_PRIVACY_NOTE}`,
    action: "download",
  }
}
