import { none, type Many } from "stream-chain/core"
import { jsonParser, type Token } from "stream-json/core/parser.js"
import replace from "stream-json/core/filters/replace.js"
import stringer from "stream-json/core/stringer.js"
import { StringDecoder } from "node:string_decoder"

const OMITTED = "[Large tool output omitted from Flapstack's display.]"
const ITEM_OUTPUTS: Record<string, readonly string[]> = {
  commandExecution: ["aggregatedOutput"],
  functionCallOutput: ["output"],
  mcpToolCall: ["result"],
  dynamicToolCall: ["contentItems"],
  imageGeneration: ["result"],
  function_call_output: ["output"],
  custom_tool_call_output: ["output"],
  tool_search_output: ["tools"],
  image_generation_call: ["result"],
}
const OUTPUT_FIELDS = new Set(Object.values(ITEM_OUTPUTS).flat())
const OPTIONS = {
  packStrings: false,
  streamKeys: false,
  streamNumbers: false,
  maxDepth: 128,
  maxPackedLength: 65_536,
}
type JsonPath = (string | number | null)[]
type Message = Record<string, unknown>
type DisplayField = { path: JsonPath; value: unknown }
const STRINGER_OPTIONS = { useKeyValues: true, useNumberValues: true }

function record(value: unknown): Message {
  return value && typeof value === "object" ? (value as Message) : {}
}

function itemPath(path: JsonPath): boolean {
  if (path[0] === "params" && path[1] === "item") return path.length === 3
  const start = path[0] === "params" && path[1] === "turn" ? 2 : 4
  if (
    start === 4 &&
    !(
      path[0] === "result" &&
      path[1] === "thread" &&
      path[2] === "turns" &&
      typeof path[3] === "number"
    )
  )
    return false
  return path.length === start + 3 && path[start] === "items" && typeof path[start + 1] === "number"
}

function outputPath(path: JsonPath): boolean {
  const field = path.at(-1)
  if (typeof field !== "string") return false
  if (path.length === 2 && path[0] === "params") return field === "delta"
  if (path.length === 2 && path[0] === "result") return field === "stdout" || field === "stderr"
  return OUTPUT_FIELDS.has(field) && itemPath(path)
}

// The library uses the same sentinel to flush each synchronous token stage.
function flush<T, R>(stage: (input: T) => R): R {
  return (stage as (input: T | typeof none) => R)(none)
}

export class LargeCodexToolFrame {
  private readonly decoder = new StringDecoder("utf8")
  private readonly parse = jsonParser(OPTIONS)
  private readonly stringify = stringer(STRINGER_OPTIONS)
  private readonly fields: DisplayField[] = []
  private capture: {
    field: DisplayField
    format: ReturnType<typeof stringer>
    text: string
    depth: number
  } | null = null
  private capturedBytes = 0
  private readonly filter = replace({
    ...OPTIONS,
    filter: outputPath,
    replacement: (path: JsonPath) => {
      if (this.fields.length >= 4096) throw new Error("Too many tool outputs in one frame")
      const field = { path: [...path], value: OMITTED }
      this.fields.push(field)
      this.capture = { field, format: stringer(STRINGER_OPTIONS), text: "", depth: 0 }
      return OMITTED
    },
  })
  private text = ""
  private retainedBytes = 0

  write(bytes: Buffer): void {
    // The tokenizer emits a token batch per input piece. Bound that batch independently of pipe chunk size.
    for (let i = 0; i < bytes.length; i += 16_384) {
      this.consume(this.parse(this.decoder.write(bytes.subarray(i, i + 16_384))))
    }
  }

  finish(pendingMethod: (id: number) => string | undefined): string {
    this.consume(this.parse(this.decoder.end()))
    this.consume(flush(this.parse))
    this.append(flush(this.filter))
    const message: unknown = JSON.parse(this.text)
    const frame = record(message)
    const method = Object.hasOwn(frame, "id")
      ? typeof frame.id === "number" &&
        !Object.hasOwn(frame, "method") &&
        !Object.hasOwn(frame, "error")
        ? pendingMethod(frame.id)
        : undefined
      : frame.method
    const safe =
      this.fields.length > 0 &&
      this.fields.every(({ path }) => {
        // Validate the envelope *after* tokenization. The JSON-RPC id or method can follow the payload.
        if (path[0] === "result") {
          if (path.length === 2) return method === "command/exec"
          if (
            !["thread/read", "thread/start", "thread/resume", "thread/fork"].includes(
              String(method),
            )
          )
            return false
        } else if (path.length === 2) {
          return method === "item/commandExecution/outputDelta"
        } else if (
          path[1] === "turn"
            ? method !== "turn/completed"
            : method !== "item/completed" &&
              method !== "item/started" &&
              method !== "rawResponseItem/completed"
        ) {
          return false
        }
        let item: unknown = frame
        for (const key of path.slice(0, -1)) item = record(item)[String(key)]
        const type = record(item).type
        return (
          typeof type === "string" &&
          Object.hasOwn(ITEM_OUTPUTS, type) &&
          ITEM_OUTPUTS[type]!.includes(String(path.at(-1)))
        )
      })
    if (!safe) throw new Error("Frame contains oversized non-tool data")
    for (const { path, value } of this.fields) {
      let parent = frame
      for (const key of path.slice(0, -1)) parent = record(parent[String(key)])
      parent[String(path.at(-1))] = value
    }
    return JSON.stringify(frame)
  }

  private consume(batch: Many<Token> | typeof none): void {
    if (batch === none) return
    for (const token of batch.values) {
      this.append(this.filter(token))
      // Preserve small neighboring results and stderr even if another field in this frame is enormous.
      const capture = this.capture
      if (!capture) continue
      const text = capture.format(token)
      if (text !== none) capture.text += text
      if (capture.text.length > 16_384 || this.capturedBytes >= 2 * 1024 * 1024) {
        this.capture = null
        continue
      }
      if (
        token.name === "startString" ||
        token.name === "startArray" ||
        token.name === "startObject"
      )
        capture.depth++
      if (token.name === "endString" || token.name === "endArray" || token.name === "endObject")
        capture.depth--
      if (capture.depth === 0) {
        capture.field.value = JSON.parse(capture.text)
        this.capturedBytes += Buffer.byteLength(capture.text)
        this.capture = null
      }
    }
  }

  private append(value: Token | Many<Token> | typeof none): void {
    if (value === none) return
    const tokens = "values" in value ? value.values : [value]
    for (const token of tokens) {
      const text = this.stringify(token)
      if (text === none) continue
      this.retainedBytes += Buffer.byteLength(text)
      if (this.retainedBytes > 2 * 1024 * 1024) throw new Error("Oversized non-tool metadata")
      this.text += text
    }
  }
}
