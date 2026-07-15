import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import {
  RuntimeDefaultsError,
  createRuntimeDefaultsService,
} from "../src/main/lib/agent-runtime/defaults"
import { applyRuntimeMigration, createLegacyRuntimeDatabase } from "./agent-runtime-test-db"

describe("Agent Runtime defaults", () => {
  let database: Database.Database

  beforeEach(() => {
    database = createLegacyRuntimeDatabase()
    applyRuntimeMigration(database)
    database
      .prepare("INSERT INTO projects (id, archived_at) VALUES ('project-1', NULL), ('archived', 1)")
      .run()
  })

  afterEach(() => database.close())

  it("writes global and project per-harness defaults with optimistic versions", () => {
    const service = createRuntimeDefaultsService(database)
    const global = service.write({
      scope: { type: "global", id: null },
      harness: "codex",
      preference: "flapstack-native",
      expectedVersion: 0,
    })
    const project = service.write({
      scope: { type: "project", id: "project-1" },
      harness: "codex",
      preference: "codex",
      expectedVersion: 0,
    })
    expect(global.version).toBe(1)
    expect(project.scope).toEqual({ type: "project", id: "project-1" })
    expect(service.list({ harness: "codex" })).toHaveLength(2)

    expect(
      service.write({
        scope: global.scope,
        harness: "codex",
        preference: "auto",
        expectedVersion: 1,
      }),
    ).toMatchObject({ preference: "auto", version: 2 })
    expect(() =>
      service.write({
        scope: global.scope,
        harness: "codex",
        preference: "codex",
        expectedVersion: 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeDefaultsError>>({
        code: "settings-version-conflict",
      }),
    )
  })

  it("detects create races and stale deletes", () => {
    const service = createRuntimeDefaultsService(database)
    const input = {
      scope: { type: "global" as const, id: null },
      harness: "claude-code",
      preference: "claude-code" as const,
      expectedVersion: 0,
    }
    const created = service.write(input)
    expect(() => service.write(input)).toThrow(/version conflict/i)
    expect(() => service.delete({ ...input, expectedVersion: created.version + 1 })).toThrow(
      /version conflict/i,
    )
    expect(service.delete({ ...input, expectedVersion: created.version })).toBe(true)
  })

  it.each(["missing", "archived"])("rejects %s project scopes", (projectId) => {
    const service = createRuntimeDefaultsService(database)
    expect(() =>
      service.write({
        scope: { type: "project", id: projectId },
        harness: "codex",
        preference: "codex",
        expectedVersion: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "project-missing" }))
  })
})
