import type { McpControlResponse } from "./types"

export const MCP_RESPONSE_BYTES = 64 * 1024
// Allow for the JSON-RPC envelope and a request ID of at most 128 characters.
const RESULT_BYTES = MCP_RESPONSE_BYTES - 1024

function resultFor(response: McpControlResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response) }],
    structuredContent: response,
    isError: !response.ok,
  }
}

export function fitsMcpResponse(data: unknown) {
  return Buffer.byteLength(JSON.stringify(resultFor({ ok: true, data }))) <= RESULT_BYTES
}

export function boundedMcpResult(response: McpControlResponse) {
  const result = resultFor(response)
  if (Buffer.byteLength(JSON.stringify(result)) <= RESULT_BYTES) return result
  return resultFor({
    ok: false,
    error: { code: "invalid-input", message: "The result exceeds 64 KiB. Request a smaller page." },
  })
}

/** The caller retains its existing cursor semantics, including newest-first reads. */
export function budgetMcpPage<T>(items: T[], makePage: (kept: T[], truncated: boolean) => unknown) {
  for (let count = items.length; count >= 0; count--) {
    const page = makePage(items.slice(0, count), count < items.length)
    if (fitsMcpResponse(page)) return page
  }
  throw new Error("MCP page metadata exceeds the response budget.")
}

export function budgetMcpDiff(text: string, offset: number, limit: number, diffHash: string) {
  // Keep the existing UTF-16 offsets. New continuation offsets never split a surrogate pair.
  const pageAt = (count: number) => {
    let end = Math.min(text.length, offset + count)
    if (end > offset && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff)
      end += end === offset + 1 ? 1 : -1
    return {
      diff: text.slice(offset, end),
      total: text.length,
      offset,
      diffHash,
      nextOffset: end < text.length ? end : null,
      truncated: end < text.length,
    }
  }
  const full = pageAt(limit)
  if (fitsMcpResponse(full)) return full
  let low = 0
  let high = limit
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (fitsMcpResponse(pageAt(middle))) low = middle
    else high = middle
  }
  return pageAt(low)
}
