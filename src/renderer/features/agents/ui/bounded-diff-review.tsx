import { useEffect, useRef, useState } from "react"
import { Button } from "../../../components/ui/button"
import { trpcClient } from "../../../lib/trpc"
import type { ParsedDiffFile } from "./agent-diff-model"
import type { SelectedLineRange } from "@pierre/diffs"

type Review = Awaited<
  ReturnType<typeof import("../../../../main/lib/diff-annotations/review").readDiffReview>
>

export function BoundedDiffReview({
  chatId,
  file,
  onComment,
}: {
  chatId?: string
  file: ParsedDiffFile
  onComment?: (file: ParsedDiffFile, range: SelectedLineRange) => void
}) {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [decodeErrors, setDecodeErrors] = useState<string[]>([])
  const viewport = useRef<HTMLDivElement | null>(null)
  const request = useRef<{ unsubscribe: () => void } | null>(null)
  useEffect(() => {
    request.current?.unsubscribe()
    setReview(null)
    setError("")
    setLoading(false)
    return () => {
      request.current?.unsubscribe()
    }
  }, [chatId, file.key, file.observedDiffHash])
  const load = (offset = 0) => {
    if (!chatId || !file.observedDiffHash) return
    request.current?.unsubscribe()
    setLoading(true)
    setError("")
    request.current = trpcClient.chats.getDiffReview.subscribe(
      { chatId, diffHash: file.observedDiffHash, fileKey: file.key, offset },
      {
        onData(result) {
          setReview(result)
          setDecodeErrors([])
          if (viewport.current) viewport.current.scrollTop = 0
          setLoading(false)
        },
        onError(cause) {
          setError(cause.message)
          setLoading(false)
        },
        onComplete() {
          setLoading(false)
        },
      },
    )
  }
  const available = !!chatId && !!file.observedDiffHash
  return (
    <section
      className="space-y-3 p-3 text-xs"
      aria-label={`Diff preview for ${file.newPath || file.oldPath}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!available || loading}
          onClick={() => void load()}
        >
          {review ? "Reload preview" : file.isBinary ? "Preview images" : "Review large diff"}
        </Button>
        {loading && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              request.current?.unsubscribe()
              setLoading(false)
            }}
          >
            Cancel loading
          </Button>
        )}
        {!available && (
          <span className="text-muted-foreground">Refresh the local diff to enable review.</span>
        )}
        {loading && <span role="status">Loading preview…</span>}
      </div>
      {error && <p role="alert">{error}</p>}
      {review?.kind === "image" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="min-w-0">
              <figcaption className="mb-2 font-medium">
                {side === "before" ? "Before" : "After"}
              </figcaption>
              {review[side] ? (
                <>
                  {decodeErrors.includes(side) ? (
                    <p role="alert">This image could not be decoded.</p>
                  ) : (
                    <img
                      src={review[side].dataUrl}
                      alt={`${side === "before" ? "Before" : "After"} ${side === "before" ? file.oldPath : file.newPath}`}
                      className="max-h-80 max-w-full object-contain"
                      onError={() => setDecodeErrors((current) => [...current, side])}
                    />
                  )}
                  <details className="mt-2 text-muted-foreground">
                    <summary>Image identity</summary>
                    <code className="break-all">{review[side].hash}</code>
                  </details>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {side === "before" ? "New image" : "Image deleted"}
                </p>
              )}
            </figure>
          ))}
        </div>
      )}
      {review?.kind === "text" && (
        <>
          <p className="text-muted-foreground" role="status">
            Patch rows {review.offset + 1}–{review.offset + review.rows.length} of {review.total}.
            Other rows are not loaded.
          </p>
          <div
            ref={viewport}
            className="max-h-96 overflow-auto"
            tabIndex={0}
            aria-label="Diff section"
          >
            <table className="w-full font-mono">
              <thead>
                <tr>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                  <th scope="col">Change</th>
                  {onComment && <th scope="col">Comment</th>}
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row, index) => (
                  <tr
                    key={review.offset + index}
                    className={
                      row.text.startsWith("+")
                        ? "bg-green-500/10"
                        : row.text.startsWith("-")
                          ? "bg-red-500/10"
                          : ""
                    }
                  >
                    <td className="align-top text-muted-foreground">{row.left}</td>
                    <td className="align-top text-muted-foreground">{row.right}</td>
                    <td className="whitespace-pre-wrap break-all">
                      {row.text}
                      {row.truncated && (
                        <span> [Line shortened; open in editor for full text]</span>
                      )}
                    </td>
                    {onComment && (
                      <td className="align-top">
                        {!row.truncated && (row.right !== null || row.left !== null) && (
                          <button
                            type="button"
                            className="rounded px-2 focus-visible:outline focus-visible:outline-2"
                            aria-label={`Comment on ${row.right !== null ? "after" : "before"} line ${row.right ?? row.left}`}
                            onClick={() =>
                              onComment(file, {
                                start: (row.right ?? row.left)!,
                                end: (row.right ?? row.left)!,
                                side: row.right !== null ? "additions" : "deletions",
                              })
                            }
                          >
                            Comment
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || review.offset === 0}
              onClick={() => void load(Math.max(0, review.offset - 200))}
            >
              Previous section
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || review.next === null}
              onClick={() => void load(review.next!)}
            >
              Next section
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
