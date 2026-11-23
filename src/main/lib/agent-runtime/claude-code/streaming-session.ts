import { createHash, randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ClaudeRuntimeQueryInput } from "./types"

type PermissionCallback = (...args: unknown[]) => unknown
type Input = { message: unknown; resolve(): void; reject(error: Error): void }

// A persistent SDK input stream must remain open between prompts. Each output iterator
// below stops at its own result without calling return() on the underlying SDK query.
export class ClaudeStreamingSession {
  private readonly input = new PassThrough({ objectMode: true })
  private readonly controller = new AbortController()
  private readonly pending = new Set<Input>()
  private readonly steering = new Map<
    string,
    { queued: boolean; resolve(): void; reject(error: Error): void }
  >()
  private readonly messages: AsyncIterator<SDKMessage>
  private permission: PermissionCallback | null = null
  private closed = false
  private turnActive = false
  private backgroundWork = false

  get reusable(): boolean {
    return !this.closed && !this.backgroundWork && this.steering.size === 0
  }

  constructor(
    query: (input: ClaudeRuntimeQueryInput) => AsyncIterable<SDKMessage>,
    options: Record<string, unknown>,
  ) {
    const canUseTool = (...args: unknown[]) => {
      if (!this.permission || !this.turnActive)
        return { behavior: "deny", message: "This turn is no longer active." }
      return this.permission(...args)
    }
    this.messages = query({
      prompt: this.inputs(),
      options: {
        ...options,
        abortController: this.controller,
        ...(options.canUseTool ? { canUseTool } : {}),
      },
    })[Symbol.asyncIterator]()
  }

  private async *inputs(): AsyncIterable<unknown> {
    for await (const entry of this.input) {
      if (this.closed) break
      yield entry.message
      // The SDK requests the next input only after writing this one to the native transport.
      this.pending.delete(entry)
      entry.resolve()
    }
  }

  private write(message: unknown): Promise<void> {
    if (this.closed || !this.turnActive)
      return Promise.reject(new Error("The Claude turn has ended."))
    return new Promise((resolve, reject) => {
      const entry = { message, resolve, reject }
      this.pending.add(entry)
      this.input.write(entry)
    })
  }

  private userMessage(text: string, steer = false) {
    return {
      type: "user",
      uuid: randomUUID(),
      origin: { kind: "human" },
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      ...(steer ? { priority: "now" } : {}),
    }
  }

  steer(text: string): Promise<void> {
    const message = this.userMessage(text, true)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error("Claude did not confirm steering. Check this turn before sending again."),
          ),
        30_000,
      )
      timeout.unref()
      this.steering.set(message.uuid, {
        queued: false,
        resolve() {
          clearTimeout(timeout)
          resolve()
        },
        reject(error) {
          clearTimeout(timeout)
          reject(error)
        },
      })
      void this.write(message).catch((error) => {
        clearTimeout(timeout)
        this.steering.delete(message.uuid)
        reject(error)
      })
    })
  }

  async *turn(input: ClaudeRuntimeQueryInput): AsyncIterable<SDKMessage> {
    if (this.closed || this.turnActive)
      throw new Error("Claude session is unavailable for a new turn.")
    this.turnActive = true
    this.permission = input.options.canUseTool as PermissionCallback | null
    const send = async () => {
      if (typeof input.prompt === "string") await this.write(this.userMessage(input.prompt))
      else for await (const message of input.prompt) await this.write(message)
    }
    const submitted = send()
    void submitted.catch(() => this.close())
    try {
      while (!this.closed) {
        const next = await this.messages.next()
        if (next.done) return
        const command = next.value as unknown as {
          type: string
          command_uuid?: string
          state?: string
          terminal_reason?: string
          subtype?: string
        }
        if (command.type === "command_lifecycle" && command.command_uuid) {
          const steer = this.steering.get(command.command_uuid)
          if (steer && (command.state === "queued" || command.state === "started")) {
            steer.queued = true
            steer.resolve()
          }
          if (
            command.state === "started" ||
            command.state === "completed" ||
            command.state === "cancelled"
          ) {
            if (command.state === "cancelled")
              steer?.reject(new Error("Claude cancelled this steering instruction."))
            this.steering.delete(command.command_uuid)
          }
          continue
        }
        if (next.value.type === "system" && next.value.subtype === "task_started")
          this.backgroundWork = true
        // Native priority:now can abort the first command and immediately start the
        // queued steering command. Both belong to the same Flapstack run.
        if (
          command.type === "result" &&
          [...this.steering.values()].some((steer) => steer.queued) &&
          (command.terminal_reason === "aborted_streaming" || command.subtype === "success")
        )
          continue
        if (next.value.type === "result") this.turnActive = false
        yield next.value
        if (!this.turnActive) return
      }
    } finally {
      this.turnActive = false
      this.permission = null
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.turnActive = false
    this.permission = null
    for (const entry of this.pending)
      entry.reject(new Error("The Claude session closed before delivery."))
    this.pending.clear()
    for (const steer of this.steering.values())
      steer.reject(new Error("Claude closed before accepting steering."))
    this.steering.clear()
    this.controller.abort()
    this.input.end()
    void this.messages.return?.().catch(() => undefined)
  }
}

// Settings and permissions are resolved for every turn. Retain only sessions with
// precisely the same native arguments; run-owned callbacks other than canUseTool
// must remain bound to their original run.
export async function claudeWarmOptionsKey(
  options: Record<string, unknown>,
): Promise<string | null> {
  const { abortController, resume, canUseTool, ...native } = options
  void abortController
  void resume
  if (native.forkSession || native.resumeSessionAt) return null
  let reusable = true
  const encoded = JSON.stringify({ native, permissionBridge: Boolean(canUseTool) }, (_, value) => {
    if (typeof value === "function") reusable = false
    return value
  })
  if (!reusable) return null
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
  const paths = [join(config, ".credentials.json"), join(config, "settings.json")]
  if (typeof native.pathToClaudeCodeExecutable === "string")
    paths.push(native.pathToClaudeCodeExecutable)
  if (typeof native.cwd === "string")
    paths.push(
      join(native.cwd, ".claude", "settings.json"),
      join(native.cwd, ".claude", "settings.local.json"),
    )
  const stamps = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(path, { bigint: true })
        return [path, String(info.ino), String(info.size), String(info.mtimeNs)]
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [path, "missing"]
        return null
      }
    }),
  )
  if (stamps.includes(null)) return null
  return createHash("sha256")
    .update(encoded)
    .update(JSON.stringify(stamps))
    .update(
      JSON.stringify([
        process.env.ANTHROPIC_API_KEY,
        process.env.ANTHROPIC_AUTH_TOKEN,
        process.env.CLAUDE_CODE_OAUTH_TOKEN,
        process.env.ANTHROPIC_BASE_URL,
      ]),
    )
    .digest("hex")
}
