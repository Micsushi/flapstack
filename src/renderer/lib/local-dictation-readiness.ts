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
  selectedAdapterId?: string
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
    (adapter) =>
      adapter.adapterId ===
      (availability.selectedAdapterId ?? availability.method ?? "local-whisper"),
  )
  const parakeet = localAdapter?.adapterId === "local-parakeet"
  const modelName = parakeet ? "Parakeet" : "Local Whisper"

  if (!availability || !localAdapter) {
    return {
      kind: "checking",
      ready: false,
      title: "Checking local dictation",
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "wait",
    }
  }

  if (localAdapter.adapterId === "openai-whisper") {
    return {
      kind: localAdapter.available ? "ready" : "needs-engine",
      ready: localAdapter.available,
      title: localAdapter.available ? "Cloud dictation ready" : "Cloud dictation needs setup",
      description:
        localAdapter.reason ??
        "Recordings are sent to OpenAI using your selected cloud dictation setting.",
      action: localAdapter.available ? "record" : "open-settings",
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
      title: parakeet
        ? "Parakeet dictation engine is missing"
        : "Local dictation needs whisper.cpp",
      description: parakeet
        ? `Reinstall Flapstack to restore its dictation engine. ${LOCAL_DICTATION_PRIVACY_NOTE}`
        : `Install whisper.cpp and set the whisper-cli path in Voice settings. ${LOCAL_DICTATION_PRIVACY_NOTE}`,
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
      title: `Checking ${modelName} model`,
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
      title: `Downloading ${modelName} model (${modelStatus.percent}%)`,
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      action: "wait",
      percent: modelStatus.percent,
    }
  }

  if (modelStatus.status === "error") {
    return {
      kind: "error",
      ready: false,
      title: `${modelName} model download failed`,
      description: `${modelStatus.message} ${LOCAL_DICTATION_PRIVACY_NOTE}`,
      action: "retry",
    }
  }

  return {
    kind: "needs-model",
    ready: false,
    title: "Local dictation needs a model",
    description: parakeet
      ? `The included Parakeet model is missing or damaged. Download it again (about 731 MB). ${LOCAL_DICTATION_PRIVACY_NOTE}`
      : `Download the Local Whisper base model once (about 150 MB). ${LOCAL_DICTATION_PRIVACY_NOTE}`,
    action: "download",
  }
}
