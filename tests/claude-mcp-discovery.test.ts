import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ http: vi.fn(), stdio: vi.fn(), hydrate: vi.fn() }))
vi.mock("../src/main/lib/mcp-auth", () => ({
  fetchMcpTools: mocks.http,
  fetchMcpToolsStdio: mocks.stdio,
}))
vi.mock("../src/main/lib/mcp-secrets", () => ({ hydrateMcpServerSecrets: mocks.hydrate }))
import { fetchToolsForServer } from "../src/main/lib/claude/mcp-discovery"

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.hydrate.mockImplementation((config) => config)
})
afterEach(() => vi.useRealTimers())

it.each(["http", "stdio"])(
  "cancels %s discovery at the deadline and returns empty tools",
  async (kind) => {
    let received: AbortSignal | undefined
    const stalled = (...args: unknown[]) => {
      received = args.at(-1) as AbortSignal
      return new Promise((_, reject) =>
        received!.addEventListener("abort", () => reject(new Error("aborted"))),
      )
    }
    mocks[kind as "http" | "stdio"].mockImplementation(stalled)
    const pending = fetchToolsForServer(
      kind === "http" ? { url: "https://synthetic.invalid" } : { command: "synthetic" },
    )
    expect(received?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(39_999)
    expect(received?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(received?.aborted).toBe(true)
    await expect(pending).resolves.toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  },
)

it.each(["http", "stdio"])("clears the %s deadline after success or failure", async (kind) => {
  const transport = mocks[kind as "http" | "stdio"]
  const config = kind === "http" ? { url: "https://synthetic.invalid" } : { command: "synthetic" }
  transport.mockResolvedValueOnce([{ name: "synthetic-tool" }])
  await expect(fetchToolsForServer(config)).resolves.toEqual([{ name: "synthetic-tool" }])
  expect(vi.getTimerCount()).toBe(0)
  transport.mockRejectedValueOnce(new Error("synthetic failure"))
  await expect(fetchToolsForServer(config)).resolves.toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it("uses hydrated transport values without moving hydration into transport code", async () => {
  const input = { command: "stored", env: { TOKEN: "reference" } }
  mocks.hydrate.mockReturnValue({
    command: "resolved",
    args: ["argument"],
    env: { TOKEN: "synthetic-value" },
  })
  mocks.stdio.mockResolvedValue([])
  await fetchToolsForServer(input)
  expect(mocks.hydrate).toHaveBeenCalledExactlyOnceWith(input)
  expect(mocks.stdio).toHaveBeenCalledWith(
    { command: "resolved", args: ["argument"], env: { TOKEN: "synthetic-value" } },
    expect.any(AbortSignal),
  )
  expect(vi.getTimerCount()).toBe(0)
})
