import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import { discoverProviderExtensions } from "../src/main/lib/provider-extensions"
import {
  extensionPolicyTargetFromManifest,
  setExtensionEnablementPolicy,
} from "../src/main/lib/extension-management/enablement-policy"
import { listNativeSkillMentions } from "../src/main/lib/skills/mention-catalog"

vi.mock("../src/main/lib/plugins", () => ({ discoverInstalledPlugins: async () => [] }))
vi.mock("../src/main/lib/git/security/path-validation", () => ({
  assertRegisteredWorktree: (path: string) => ({ canonicalPath: path }),
}))

describe("native composer skill discovery", () => {
  let root: string
  let homeDir: string
  let projectRoot: string
  let sqlite: Database.Database
  let database: ReturnType<typeof drizzle<typeof schema>>
  const writeSkill = (path: string, name: string) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} description\n---\n${name} body`,
    )
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flapstack-skill-picker-"))
    homeDir = join(root, "home")
    projectRoot = join(root, "project")
    mkdirSync(homeDir)
    mkdirSync(projectRoot)
    sqlite = new Database(":memory:")
    database = drizzle(sqlite, { schema })
    migrateDatabase(database, sqlite, resolve("drizzle"))
    database.insert(schema.projects).values({ id: "p", name: "Project", path: projectRoot }).run()
    database
      .insert(schema.projects)
      .values({ id: "other", name: "Other", path: join(root, "other") })
      .run()
    database.insert(schema.tasks).values({ id: "t", name: "Task", projectId: "p" }).run()
    database
      .insert(schema.chats)
      .values({ id: "c", projectId: "p", taskId: "t", scope: "task", harness: "claude-code" })
      .run()
    database
      .insert(schema.subChats)
      .values({ id: "s", chatId: "c", harness: "codex", worktreePath: projectRoot })
      .run()
  })

  afterEach(() => {
    sqlite.close()
    rmSync(root, { recursive: true, force: true })
  })

  it("reads native user/project skills for the exact pane runtime and scope", async () => {
    writeSkill(join(homeDir, ".agents", "skills", "user"), "user")
    writeSkill(join(projectRoot, ".agents", "skills", "project"), "project")
    writeSkill(join(projectRoot, ".codex", "skills", "legacy"), "legacy")
    writeSkill(join(homeDir, ".claude", "skills", "vendor"), "vendor")
    const result = await listNativeSkillMentions(
      database,
      { subChatId: "s", projectId: "other", harness: "claude-code" },
      { homeDir },
    )
    expect(result.harness).toBe("codex")
    expect(result.skills.map((skill) => skill.name)).toEqual(["project", "legacy", "user"])
    expect(result.skills[0]).toMatchObject({
      source: "project",
      provider: "codex",
      compatibility: false,
    })
    expect(result.skills[1]).toMatchObject({
      source: "project",
      provider: "codex",
      compatibility: true,
    })
  })

  it("honors task policy and never revives a disabled native skill through a compatibility alias", async () => {
    writeSkill(join(homeDir, ".agents", "skills", "review"), "review")
    writeSkill(join(homeDir, ".codex", "skills", "review"), "review")
    const native = (await discoverProviderExtensions({ homeDir, cwd: projectRoot })).find(
      (entry) =>
        entry.kind === "skill" &&
        entry.name === "review" &&
        entry.capabilities.discovery === "supported",
    )!
    setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(native),
      location: { type: "task", projectId: "p", taskId: "t" },
      enabled: false,
    })
    expect(
      (await listNativeSkillMentions(database, { subChatId: "s" }, { homeDir })).skills,
    ).toEqual([])
    const draft = await listNativeSkillMentions(
      database,
      { projectId: "p", harness: "codex" },
      { homeDir },
    )
    expect(draft.skills).toHaveLength(1)
    expect(draft.skills[0].compatibility).toBe(false)
  })

  it("validates draft task/project scope and returns no guessed inventory without a runtime", async () => {
    await expect(
      listNativeSkillMentions(
        database,
        { projectId: "other", taskId: "t", harness: "codex" },
        { homeDir },
      ),
    ).rejects.toThrow("Task does not belong")
    expect((await listNativeSkillMentions(database, {}, { homeDir })).skills).toEqual([])
    await expect(
      listNativeSkillMentions(database, { subChatId: "missing" }, { homeDir }),
    ).rejects.toThrow("Chat not found")
  })
})
