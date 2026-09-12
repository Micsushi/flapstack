import { expect, it, vi } from "vitest"
const database = vi.hoisted(() => ({
  get: vi.fn(() => {
    throw new Error("Unexpected database access")
  }),
}))
vi.mock("../src/main/lib/db", () => ({
  getDatabase: database.get,
  tasks: {},
  chats: {},
  projects: {},
}))
vi.mock("../src/main/lib/git/worktree", () => ({
  createWorktree: vi.fn(),
  getDefaultBranch: vi.fn(),
}))
vi.mock("../src/main/lib/trpc/index", async () => {
  const { initTRPC } = await import("@trpc/server")
  const t = initTRPC.create()
  return {
    router: t.router,
    middleware: t.middleware,
    publicProcedure: t.procedure,
    betaProcedure: () => t.procedure,
  }
})
import { tasksRouter } from "../src/main/lib/trpc/routers/tasks"

it("rejects every supported legacy task mutation before DB or worktree access in canonical mode", async () => {
  vi.stubEnv("FLAPSTACK_PROJECT_RECORDS_URL", "http://127.0.0.1:47839")
  try {
    const caller = tasksRouter.createCaller({ getWindow: () => null })
    const operations = [
      () => caller.create({ projectId: "project", name: "bypass" }),
      () => caller.update({ id: "task", expectedVersion: 1, name: "bypass" }),
      () => caller.delete({ id: "task" }),
      () => caller.pin({ id: "task" }),
      () => caller.unpin({ id: "task" }),
      () => caller.archive({ id: "task" }),
      () => caller.restore({ id: "task" }),
      () => caller.moveCard({ id: "task", expectedVersion: 1, targetStatus: "done" }),
      () => caller.archiveCard({ id: "task", expectedVersion: 1 }),
      () => caller.ensurePrimaryWorktree({ id: "task" }),
    ]
    for (const operation of operations)
      await expect(operation()).rejects.toThrow("Project records owns")
    expect(database.get).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
  }
})
