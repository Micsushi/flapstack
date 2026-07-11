import { useEffect, useState } from "react"
import { Download, Play, Square } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { playManagedSpeech, stopManagedSpeech } from "../../../lib/speech-playback"

export function AgentsVoiceTab() {
  const utils = trpc.useUtils()
  const { data: settings } = trpc.speech.getSettings.useQuery()
  const { data: adapters } = trpc.speech.listAdapters.useQuery()
  const { data: voices } = trpc.speech.listVoices.useQuery()
  const { data: sttModels } = trpc.speech.listSttModels.useQuery()
  const updateSettings = trpc.speech.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.speech.getSettings.invalidate()
      await utils.speech.listAdapters.invalidate()
      await utils.speech.listVoices.invalidate()
      await utils.speech.getReadAloudForChat.invalidate()
      await utils.speech.getSttModelStatus.invalidate()
    },
  })
  const speak = trpc.speech.speak.useMutation()
  const stopSpeaking = trpc.speech.stopSpeaking.useMutation()
  const [previewText, setPreviewText] = useState("Flapstack voice output is ready.")
  const [historySearch, setHistorySearch] = useState("")
  const { data: history } = trpc.speech.searchHistory.useQuery({ query: historySearch })

  useEffect(() => {
    if (!settings) return
    setPreviewText((current) => current || "Flapstack voice output is ready.")
  }, [settings])

  if (!settings || !adapters) {
    return <div className="p-6 text-sm text-muted-foreground">Loading voice settings</div>
  }

  const update = (patch: Partial<typeof settings>) => updateSettings.mutate(patch)
  const selectedTtsAvailability = adapters.availability.tts?.[settings.ttsAdapterId]
  const selectedSttAvailability = adapters.availability.stt?.[settings.sttAdapterId]

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Voice</h3>
        <p className="text-xs text-muted-foreground">
          Dictation and read-aloud use local adapters first when available.
        </p>
      </div>

      <section className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          Speech to text
        </h4>
        <select
          value={settings.sttAdapterId}
          onChange={(event) => update({ sttAdapterId: event.target.value })}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {adapters.stt.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.label}
            </option>
          ))}
        </select>
        <StatusLine
          available={selectedSttAvailability?.available}
          text={selectedSttAvailability?.reason || "Selected STT adapter is available."}
        />
        {settings.sttAdapterId === "local-whisper" && (
          <>
            <label className="space-y-1.5 block">
              <span className="text-sm text-foreground">Whisper model</span>
              <select
                value={settings.whisperModelId}
                onChange={(event) =>
                  update({
                    whisperModelId: event.target.value as typeof settings.whisperModelId,
                  })
                }
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {sttModels?.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} ({Math.round(model.sizeBytes / 1024 / 1024)} MB)
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                Models download once and stay on this device. Changing models keeps earlier
                downloads.
              </span>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm text-foreground">whisper.cpp binary path</span>
              <input
                value={settings.whisperCppBinPath || ""}
                onChange={(event) => update({ whisperCppBinPath: event.target.value || null })}
                placeholder="Path to whisper-cli (optional)"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                Packaged builds use the bundled engine. Set this only to override it in development.
              </span>
            </label>
            <WhisperModelStatus
              model={sttModels?.find((model) => model.id === settings.whisperModelId)}
              binaryReady={Boolean(
                selectedSttAvailability && selectedSttAvailability.missingDependency !== "engine",
              )}
            />
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.preferOffline}
            onChange={(event) => update({ preferOffline: event.target.checked })}
          />
          Prefer offline adapters
        </label>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          Voice history
        </h4>
        <input
          value={historySearch}
          onChange={(event) => setHistorySearch(event.target.value)}
          placeholder="Search dictated or spoken text"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        />
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {history?.length ? (
            history.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
              >
                <span className="w-20 shrink-0 text-muted-foreground">
                  {entry.kind === "transcription" ? "Dictation" : "Speech"}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                {entry.kind === "speech" && entry.audioPath && (
                  <button
                    type="button"
                    className="text-emerald-600 hover:text-emerald-700"
                    onClick={async () => {
                      const result = await utils.speech.getHistoryAudio.fetch({ id: entry.id })
                      await playManagedSpeech(result)
                    }}
                  >
                    Play
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching voice history.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          Text to speech
        </h4>
        <select
          value={settings.ttsAdapterId}
          onChange={(event) => update({ ttsAdapterId: event.target.value, voiceId: null })}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {adapters.tts.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.label}
            </option>
          ))}
        </select>
        <StatusLine
          available={selectedTtsAvailability?.available}
          text={selectedTtsAvailability?.reason || "Selected TTS adapter is available."}
        />

        <select
          value={settings.voiceId || ""}
          onChange={(event) => update({ voiceId: event.target.value || null })}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Default voice</option>
          {(voices?.voices || []).map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label}
            </option>
          ))}
        </select>

        <label className="space-y-1.5 block">
          <span className="text-sm text-foreground">Rate: {settings.rate.toFixed(1)}x</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.rate}
            onChange={(event) => update({ rate: Number(event.target.value) })}
            className="w-full"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.autoReadAloud}
            onChange={(event) => update({ autoReadAloud: event.target.checked })}
          />
          Read assistant replies aloud by default
        </label>

        <div className="flex gap-2">
          <input
            value={previewText}
            onChange={(event) => setPreviewText(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            type="button"
            onClick={async () => {
              stopManagedSpeech()
              const result = await speak.mutateAsync({ text: previewText })
              if (result.skipped) return
              await playManagedSpeech(result)
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            title="Preview voice"
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              stopManagedSpeech()
              stopSpeaking.mutate()
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            title="Stop speaking"
          >
            <Square className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  )
}

function WhisperModelStatus({
  binaryReady,
  model,
}: {
  binaryReady: boolean
  model?: { label: string; sizeBytes: number }
}) {
  const utils = trpc.useUtils()
  const { data: status } = trpc.speech.getSttModelStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.status === "downloading" ? 500 : false),
  })
  const download = trpc.speech.downloadSttModel.useMutation({
    onSettled: async () => {
      await utils.speech.getSttModelStatus.invalidate()
      await utils.speech.listAdapters.invalidate()
      await utils.voice.isAvailable.invalidate()
    },
  })

  const isDownloading = status?.status === "downloading" || download.isPending
  const modelLabel = model?.label ?? "Selected multilingual"
  const modelSize = model ? Math.round(model.sizeBytes / 1024 / 1024) : null
  const label = !binaryReady
    ? "whisper.cpp binary is not ready. Set its path above or install it, then download the model."
    : status?.status === "present"
      ? `${modelLabel} installed (${Math.round(status.sizeBytes / 1024 / 1024)} MB).`
      : status?.status === "downloading"
        ? `Downloading ${modelLabel}… ${status.percent}%`
        : status?.status === "error"
          ? `Download failed: ${status.message}`
          : `${modelLabel} not downloaded yet${modelSize ? ` (~${modelSize} MB)` : ""}.`

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {status?.status === "downloading" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      )}
      {binaryReady && status?.status !== "present" && (
        <button
          type="button"
          disabled={isDownloading}
          onClick={() => download.mutate()}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {isDownloading
            ? "Downloading…"
            : status?.status === "error"
              ? "Retry download"
              : "Download model"}
        </button>
      )}
    </div>
  )
}

function StatusLine({ available, text }: { available?: boolean; text: string }) {
  return (
    <p className={available ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"}>
      {available ? "Available" : "Not ready"}: {text}
    </p>
  )
}
