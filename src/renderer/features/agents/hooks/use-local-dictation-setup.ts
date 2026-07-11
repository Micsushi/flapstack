import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"

import { trpc } from "../../../lib/trpc"
import {
  getLocalDictationReadiness,
  LOCAL_DICTATION_PRIVACY_NOTE,
} from "../../../lib/local-dictation-readiness"

const DOWNLOAD_TOAST_ID = "local-whisper-model-download"

export function useLocalDictationSetup(openVoiceSettings: () => void) {
  const utils = trpc.useUtils()
  const { data: availability } = trpc.voice.isAvailable.useQuery()
  const download = trpc.speech.downloadSttModel.useMutation({
    onSettled: async () => {
      await Promise.all([
        utils.speech.getSttModelStatus.invalidate(),
        utils.speech.listAdapters.invalidate(),
        utils.voice.isAvailable.invalidate(),
      ])
    },
  })
  const { data: modelStatus } = trpc.speech.getSttModelStatus.useQuery(undefined, {
    refetchInterval: (query) =>
      download.isPending || query.state.data?.status === "downloading" ? 500 : false,
  })
  const readiness = useMemo(
    () => getLocalDictationReadiness(availability, modelStatus),
    [availability, modelStatus],
  )
  const requestedDownloadRef = useRef(false)
  const observedDownloadRef = useRef(false)
  const downloadModel = download.mutate

  const startDownload = useCallback(() => {
    requestedDownloadRef.current = true
    toast.loading("Starting Local Whisper model download", {
      id: DOWNLOAD_TOAST_ID,
      description: LOCAL_DICTATION_PRIVACY_NOTE,
      duration: Infinity,
    })
    downloadModel()
  }, [downloadModel])

  useEffect(() => {
    if (readiness.kind === "downloading") {
      observedDownloadRef.current = true
      toast.loading(readiness.title, {
        id: DOWNLOAD_TOAST_ID,
        description: readiness.description,
        duration: Infinity,
        action: { label: "Voice settings", onClick: openVoiceSettings },
      })
      return
    }

    const trackedDownload = requestedDownloadRef.current || observedDownloadRef.current
    if (!trackedDownload) return

    if (download.isPending) return
    if (readiness.kind === "ready") {
      requestedDownloadRef.current = false
      observedDownloadRef.current = false
      toast.success("Local dictation is ready", {
        id: DOWNLOAD_TOAST_ID,
        description: LOCAL_DICTATION_PRIVACY_NOTE,
      })
      return
    }
    if (readiness.kind === "error") {
      toast.error(readiness.title, {
        id: DOWNLOAD_TOAST_ID,
        description: readiness.description,
        duration: Infinity,
        action: { label: "Retry", onClick: startDownload },
      })
      return
    }
    if (readiness.kind === "needs-engine") {
      requestedDownloadRef.current = false
      observedDownloadRef.current = false
      toast.error(readiness.title, {
        id: DOWNLOAD_TOAST_ID,
        description: readiness.description,
        duration: Infinity,
        action: { label: "Voice settings", onClick: openVoiceSettings },
      })
      return
    }
    if (readiness.kind === "needs-model") {
      toast.info("Local Whisper model is not installed", {
        id: DOWNLOAD_TOAST_ID,
        description: readiness.description,
        duration: Infinity,
        action: { label: "Retry", onClick: startDownload },
      })
    }
  }, [download.isPending, openVoiceSettings, readiness, startDownload])

  const showSetup = useCallback(() => {
    if (readiness.kind === "needs-engine") {
      toast.error(readiness.title, {
        description: readiness.description,
        duration: 10_000,
        action: { label: "Voice settings", onClick: openVoiceSettings },
      })
      return
    }
    if (readiness.kind === "needs-model") {
      toast.info(readiness.title, {
        description: readiness.description,
        duration: 10_000,
        action: { label: "Download model", onClick: startDownload },
      })
      return
    }
    if (readiness.kind === "error") {
      toast.error(readiness.title, {
        description: readiness.description,
        duration: 10_000,
        action: { label: "Retry", onClick: startDownload },
      })
      return
    }
    if (readiness.kind === "downloading") {
      observedDownloadRef.current = true
      toast.loading(readiness.title, {
        id: DOWNLOAD_TOAST_ID,
        description: readiness.description,
        duration: Infinity,
        action: { label: "Voice settings", onClick: openVoiceSettings },
      })
      return
    }
    toast.info(readiness.title, {
      description: readiness.description,
      action: { label: "Voice settings", onClick: openVoiceSettings },
    })
  }, [openVoiceSettings, readiness, startDownload])

  return {
    isReady: readiness.ready,
    statusLabel: readiness.title,
    showSetup,
  }
}
