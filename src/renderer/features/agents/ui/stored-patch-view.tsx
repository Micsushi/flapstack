import { Component, useMemo, type ReactNode } from "react"
import { parsePatchFiles } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { useTheme } from "next-themes"

function RawPatch({ patch }: { patch: string }) {
  return <pre className="overflow-auto p-3 text-xs leading-5">{patch}</pre>
}

class PatchBoundary extends Component<{ patch: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <RawPatch patch={this.props.patch} /> : this.props.children
  }
}

/** Historical content only: never fetch current files or offer editing actions. */
export function StoredPatchView({ patch }: { patch: string }) {
  const { resolvedTheme } = useTheme()
  const files = useMemo(() => {
    // Keep large/binary patches intact without expensive parsing or highlighting.
    if (
      patch.length > 500_000 ||
      patch.split("\n").length > 2000 ||
      /^(GIT binary patch|Binary files )/m.test(patch)
    )
      return null
    try {
      const parsed = parsePatchFiles(patch, undefined, true).flatMap((part) => part.files)
      return parsed.length && parsed.every((file) => file.hunks.length > 0) ? parsed : null
    } catch {
      return null
    }
  }, [patch])
  if (!files) return <RawPatch patch={patch} />
  return (
    <PatchBoundary key={patch} patch={patch}>
      <div className="min-w-0 divide-y">
        {files.map((file, index) => (
          <section key={index} className="min-w-0" aria-label={file.name}>
            <div className="break-all border-b bg-muted/50 px-3 py-2 font-mono text-xs">
              {file.prevName && file.prevName !== file.name ? `${file.prevName} → ` : ""}
              {file.name}
            </div>
            <FileDiff
              fileDiff={file}
              options={{
                diffStyle: "unified",
                diffIndicators: "classic",
                overflow: "scroll",
                disableFileHeader: true,
                themeType: resolvedTheme === "light" ? "light" : "dark",
              }}
            />
          </section>
        ))}
        <details className="text-xs">
          <summary className="cursor-pointer px-3 py-2">Raw patch</summary>
          <RawPatch patch={patch} />
        </details>
      </div>
    </PatchBoundary>
  )
}
