import Database from "better-sqlite3"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync, spawn } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { projectVaultSections, projectVaults, projects } from "../src/main/lib/db/schema"
import { updateProjectVaultPolicy } from "../src/main/lib/project-vaults/policy"
import {
  ensureProjectVaultGitExclusion,
  removeProjectVaultGitExclusion,
} from "../src/main/lib/project-vaults/git-exclusion"
import {
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

const OWNED_BEGIN = "# BEGIN Flapstack project knowledge exclusion (owned):"
const OWNED_END = "# END Flapstack project knowledge exclusion (owned):"

describe("project vault Git exclusion", () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  it("installs and verifies the owned local exclusion before normal-repository writes", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)

    const { vault } = await createUntrackedVault(fixture.database, fixture.appDataRoot)

    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const exclude = readFileSync(excludePath, "utf8")
    expect(exclude).toContain(OWNED_BEGIN)
    expect(exclude).toContain("/.flapstack/knowledge/")
    expect(exclude).toContain(OWNED_END)
    expectGitIgnored(fixture.projectRoot, ".flapstack/knowledge/index.md")
    expect(readFileSync(join(vault.rootPath, "index.md"), "utf8")).toBe("# Project Knowledge\n\n")
  })

  it("writes the exclusion to the shared common directory for a linked worktree", async () => {
    const fixture = createFixture({ initializeProjectRoot: false })
    const mainRoot = join(fixture.directory, "main")
    const worktreeRoot = fixture.projectRoot
    mkdirSync(mainRoot)
    initRepository(mainRoot)
    git(mainRoot, ["worktree", "add", "-q", "--orphan", "-b", "linked-fixture", worktreeRoot])

    fixture.database.update(projects).set({ path: worktreeRoot }).run()
    await createUntrackedVault(fixture.database, fixture.appDataRoot)

    const mainExcludePath = getCommonExcludePath(mainRoot)
    expect(getCommonExcludePath(worktreeRoot)).toBe(mainExcludePath)
    expect(readFileSync(mainExcludePath, "utf8")).toContain(OWNED_BEGIN)
    expect(readFileSync(join(worktreeRoot, ".git"), "utf8")).toContain("gitdir:")
    expectGitIgnored(worktreeRoot, ".flapstack/knowledge/index.md")
  })

  it("fails before files or metadata are written when Git exclusion cannot be proven", async () => {
    const fixture = createFixture()

    updateProjectVaultPolicy(fixture.database, {
      projectId: "project-1",
      appDataRoot: fixture.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: false,
    })

    await expect(
      scaffoldProjectVault(fixture.database, {
        projectId: "project-1",
        appDataRoot: fixture.appDataRoot,
        sections: ["index"],
      }),
    ).rejects.toThrow(/Git local exclusion/)
    expect(existsSync(join(fixture.projectRoot, ".flapstack"))).toBe(false)
    expect(fixture.database.select().from(projectVaults).all()).toEqual([])
    expect(fixture.database.select().from(projectVaultSections).all()).toEqual([])
  })

  it("reinstalls and verifies a removed exclusion before a later vault write", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    await createUntrackedVault(fixture.database, fixture.appDataRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    writeFileSync(excludePath, "# user-owned rule\n/vendor-cache/\n")

    await writeProjectVaultSection(fixture.database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "# Updated\n",
    })

    expect(readFileSync(excludePath, "utf8")).toContain(OWNED_BEGIN)
    expectGitIgnored(fixture.projectRoot, ".flapstack/knowledge/index.md")
  })

  it("tracking opt-in removes only the exact Flapstack-owned exclusion block", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const userRules = "# user-owned rules\n/.flapstack/knowledge/\n/vendor-cache/\n"
    mkdirSync(dirname(excludePath), { recursive: true })
    writeFileSync(excludePath, userRules)
    await createUntrackedVault(fixture.database, fixture.appDataRoot)
    expect(readFileSync(excludePath, "utf8")).toContain(OWNED_BEGIN)

    const policy = updateProjectVaultPolicy(fixture.database, {
      projectId: "project-1",
      appDataRoot: fixture.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })

    expect(policy.gitTrackingEnabled).toBe(true)
    expect(readFileSync(excludePath, "utf8")).toBe(userRules)
  })

  it("does not touch Git metadata for an app-managed vault", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const before = readFileSync(excludePath, "utf8")

    await scaffoldProjectVault(fixture.database, {
      projectId: "project-1",
      appDataRoot: fixture.appDataRoot,
      sections: ["index"],
    })

    expect(readFileSync(excludePath, "utf8")).toBe(before)
    expect(readFileSync(excludePath, "utf8")).not.toContain(OWNED_BEGIN)
    expect(existsSync(join(fixture.projectRoot, ".flapstack"))).toBe(false)
  })

  it("waits for the common-directory interprocess lock and preserves a concurrent user edit", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const lockPath = join(dirname(excludePath), "flapstack-project-vault-exclude.lock")
    const holder = spawn(
      process.execPath,
      [
        "-e",
        [
          'const fs = require("node:fs")',
          "const lockPath = process.argv[1]",
          'const descriptor = fs.openSync(lockPath, "wx")',
          'process.stdout.write("locked\\n")',
          "setTimeout(() => {",
          '  fs.appendFileSync(process.argv[2], "# concurrent user rule\\n/vendor-cache/\\n")',
          "  fs.closeSync(descriptor)",
          "  fs.rmSync(lockPath, { force: true })",
          "}, 1500)",
        ].join("\n"),
        lockPath,
        excludePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    )
    cleanups.push(() => {
      if (!holder.killed) holder.kill()
    })
    await waitForLine(holder, "locked")

    const startedAt = Date.now()
    ensureProjectVaultGitExclusion(fixture.projectRoot)
    const elapsed = Date.now() - startedAt
    await waitForExit(holder)

    expect(elapsed).toBeGreaterThanOrEqual(1200)
    const exclude = readFileSync(excludePath, "utf8")
    expect(exclude).toContain("# concurrent user rule\n/vendor-cache/\n")
    expect(exclude).toContain(OWNED_BEGIN)
  })

  it("does not evict an old lock while its recorded owner is still alive", async () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const lockPath = join(dirname(excludePath), "flapstack-project-vault-exclude.lock")
    const holder = spawn(
      process.execPath,
      [
        "-e",
        [
          'const fs = require("node:fs")',
          "const lockPath = process.argv[1]",
          'const descriptor = fs.openSync(lockPath, "wx")',
          "fs.writeFileSync(descriptor, `${process.pid}\\n`)",
          "fs.fsyncSync(descriptor)",
          "fs.utimesSync(lockPath, new Date(0), new Date(0))",
          'process.stdout.write("locked\\n")',
          "setTimeout(() => {",
          "  fs.closeSync(descriptor)",
          "  fs.rmSync(lockPath, { force: true })",
          "}, 750)",
        ].join("\n"),
        lockPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    )
    cleanups.push(() => {
      if (!holder.killed) holder.kill()
    })
    await waitForLine(holder, "locked")

    const startedAt = Date.now()
    ensureProjectVaultGitExclusion(fixture.projectRoot)
    const elapsed = Date.now() - startedAt
    await waitForExit(holder)

    expect(elapsed).toBeGreaterThanOrEqual(500)
    expect(readFileSync(excludePath, "utf8")).toContain(OWNED_BEGIN)
  })

  it.runIf(process.platform === "win32")(
    "waits while Windows temporarily denies reads of a live stale lock",
    async () => {
      const fixture = createFixture()
      initRepository(fixture.projectRoot)
      const excludePath = getCommonExcludePath(fixture.projectRoot)
      const lockPath = join(dirname(excludePath), "flapstack-project-vault-exclude.lock")
      const readyPath = `${lockPath}.ready`
      const powershell = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
      const holder = spawn(
        powershell,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          [
            "$lockPath = $env:FLAPSTACK_TEST_LOCK_PATH",
            "$readyPath = $env:FLAPSTACK_TEST_LOCK_READY_PATH",
            "while (-not [System.IO.File]::Exists($readyPath)) { Start-Sleep -Milliseconds 10 }",
            "$stream = [System.IO.File]::Open($lockPath, 'Open', 'Read', 'None')",
            '[Console]::Out.WriteLine("locked")',
            "try { Start-Sleep -Milliseconds 2000 } finally {",
            "  $stream.Dispose()",
            "  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue",
            "}",
          ].join("; "),
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: {
            ...process.env,
            FLAPSTACK_TEST_LOCK_PATH: lockPath,
            FLAPSTACK_TEST_LOCK_READY_PATH: readyPath,
          },
        },
      )
      try {
        writeFileSync(lockPath, `${holder.pid}\n`, "utf8")
        utimesSync(lockPath, new Date(0), new Date(0))
        writeFileSync(readyPath, "ready\n", "utf8")
        await waitForLine(holder, "locked")
        let deniedRead: unknown
        try {
          readFileSync(lockPath, "utf8")
        } catch (error) {
          deniedRead = error
        }
        expect(deniedRead).toMatchObject({ code: "EBUSY" })
        expect(Date.now() - lstatSync(lockPath).mtimeMs).toBeGreaterThan(30_000)

        const startedAt = Date.now()
        ensureProjectVaultGitExclusion(fixture.projectRoot)
        const elapsed = Date.now() - startedAt
        await waitForExit(holder)

        expect(elapsed).toBeGreaterThanOrEqual(1500)
        expect(readFileSync(excludePath, "utf8")).toContain(OWNED_BEGIN)
      } finally {
        if (holder.exitCode === null && holder.signalCode === null) holder.kill()
        await waitForTermination(holder)
      }
    },
  )

  it("retries an atomic compare when a user edit lands before commit", () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    let injected = false

    ensureProjectVaultGitExclusion(fixture.projectRoot, {
      beforeCompareAndSwap: () => {
        if (injected) return
        injected = true
        appendFileSync(excludePath, "# concurrent user rule\n/vendor-cache/\n")
      },
    })

    const exclude = readFileSync(excludePath, "utf8")
    expect(exclude).toContain("# concurrent user rule\n/vendor-cache/\n")
    expect(exclude.match(new RegExp(escapeRegExp(OWNED_BEGIN), "g"))).toHaveLength(1)
  })

  it("recovers a user edit that lands after comparison but before atomic replacement", () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    let injected = false

    ensureProjectVaultGitExclusion(fixture.projectRoot, {
      afterCompareBeforeCommit: () => {
        if (injected) return
        injected = true
        appendFileSync(excludePath, "# commit-window user rule\n/generated-local/\n")
      },
    })

    const exclude = readFileSync(excludePath, "utf8")
    expect(exclude).toContain("# commit-window user rule\n/generated-local/\n")
    expect(exclude.match(new RegExp(escapeRegExp(OWNED_BEGIN), "g"))).toHaveLength(1)
  })

  it("recovers an atomic user replacement in the final commit window", () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const userReplacementPath = join(dirname(excludePath), "user-replacement.tmp")
    let injected = false

    ensureProjectVaultGitExclusion(fixture.projectRoot, {
      afterCompareBeforeCommit: () => {
        if (injected) return
        injected = true
        writeFileSync(userReplacementPath, "# atomic user rule\n/user-owned/\n")
        renameSync(userReplacementPath, excludePath)
      },
    })

    const exclude = readFileSync(excludePath, "utf8")
    expect(exclude).toContain("# atomic user rule\n/user-owned/\n")
    expect(exclude.match(new RegExp(escapeRegExp(OWNED_BEGIN), "g"))).toHaveLength(1)
  })

  it("rolls back only its insertion when post-install verification faults", () => {
    const fixture = createFixture()
    initRepository(fixture.projectRoot)
    const excludePath = getCommonExcludePath(fixture.projectRoot)
    const userRules = "# user-owned rules\n/vendor-cache/\n"
    writeFileSync(excludePath, userRules)

    expect(() =>
      ensureProjectVaultGitExclusion(fixture.projectRoot, {
        beforeVerify: () => {
          appendFileSync(excludePath, "# late user rule\n/build-cache/\n")
          throw new Error("forced verification fault")
        },
      }),
    ).toThrow("forced verification fault")

    expect(readFileSync(excludePath, "utf8")).toBe(`${userRules}# late user rule\n/build-cache/\n`)
  })

  it("rejects isolated tracking when a sibling linked worktree owns the same common rule", async () => {
    const fixture = createFixture({ initializeProjectRoot: false })
    const mainRoot = join(fixture.directory, "main")
    const siblingRoot = join(fixture.directory, "sibling")
    mkdirSync(mainRoot)
    initRepository(mainRoot)
    writeFileSync(join(mainRoot, "README.md"), "fixture\n")
    git(mainRoot, ["add", "README.md"])
    git(mainRoot, ["commit", "-q", "-m", "fixture"])
    git(mainRoot, ["worktree", "add", "-q", "-b", "linked-a", fixture.projectRoot])
    git(mainRoot, ["worktree", "add", "-q", "-b", "linked-b", siblingRoot])
    fixture.database.update(projects).set({ path: fixture.projectRoot }).run()
    fixture.database
      .insert(projects)
      .values({ id: "project-2", name: "Sibling", path: siblingRoot })
      .run()

    await createUntrackedVault(fixture.database, fixture.appDataRoot)
    await createUntrackedVault(fixture.database, fixture.appDataRoot, "project-2")
    const excludePath = getCommonExcludePath(mainRoot)
    expect(
      readFileSync(excludePath, "utf8").match(new RegExp(escapeRegExp(OWNED_BEGIN), "g")),
    ).toHaveLength(2)

    expect(() =>
      updateProjectVaultPolicy(fixture.database, {
        projectId: "project-1",
        appDataRoot: fixture.appDataRoot,
        locationMode: "project-owned",
        projectOwnedOptIn: true,
        gitTrackingEnabled: true,
        gitTrackingOptIn: true,
      }),
    ).toThrow(/linked worktree/)

    expect(
      readFileSync(excludePath, "utf8").match(new RegExp(escapeRegExp(OWNED_BEGIN), "g")),
    ).toHaveLength(2)
    expectGitIgnored(fixture.projectRoot, ".flapstack/knowledge/index.md")
    expectGitIgnored(siblingRoot, ".flapstack/knowledge/index.md")
    expect(
      fixture.database
        .select()
        .from(schema.projectVaultPolicies)
        .where(eq(schema.projectVaultPolicies.projectId, "project-1"))
        .get()?.gitTrackingEnabled,
    ).toBe(false)
  })

  it("rejects common-rule removal when a linked sibling has no owned block", async () => {
    const fixture = createFixture({ initializeProjectRoot: false })
    const mainRoot = join(fixture.directory, "main")
    const siblingRoot = join(fixture.directory, "sibling")
    mkdirSync(mainRoot)
    initRepository(mainRoot)
    writeFileSync(join(mainRoot, "README.md"), "fixture\n")
    git(mainRoot, ["add", "README.md"])
    git(mainRoot, ["commit", "-q", "-m", "fixture"])
    git(mainRoot, ["worktree", "add", "-q", "-b", "linked-sibling", siblingRoot])
    fixture.database.update(projects).set({ path: mainRoot }).run()

    await createUntrackedVault(fixture.database, fixture.appDataRoot)
    expectGitIgnored(mainRoot, ".flapstack/knowledge/index.md")
    expectGitIgnored(siblingRoot, ".flapstack/knowledge/index.md")

    expect(() =>
      updateProjectVaultPolicy(fixture.database, {
        projectId: "project-1",
        appDataRoot: fixture.appDataRoot,
        locationMode: "project-owned",
        projectOwnedOptIn: true,
        gitTrackingEnabled: true,
        gitTrackingOptIn: true,
      }),
    ).toThrow(/linked worktree/)

    expectGitIgnored(mainRoot, ".flapstack/knowledge/index.md")
    expectGitIgnored(siblingRoot, ".flapstack/knowledge/index.md")
    expect(
      fixture.database
        .select()
        .from(schema.projectVaultPolicies)
        .where(eq(schema.projectVaultPolicies.projectId, "project-1"))
        .get()?.gitTrackingEnabled,
    ).toBe(false)
  })

  function createFixture(options: { initializeProjectRoot?: boolean } = {}): {
    directory: string
    appDataRoot: string
    projectRoot: string
    database: AppDatabase
  } {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-vault-git-"))
    const appDataRoot = join(directory, "app-data")
    const projectRoot = join(directory, "project")
    mkdirSync(appDataRoot)
    if (options.initializeProjectRoot !== false) mkdirSync(projectRoot)
    const sqlite = new Database(join(directory, "agents.db"))
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database.insert(projects).values({ id: "project-1", name: "Project", path: projectRoot }).run()
    cleanups.push(() => {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return { directory, appDataRoot, projectRoot, database }
  }
})

async function createUntrackedVault(
  database: AppDatabase,
  appDataRoot: string,
  projectId = "project-1",
) {
  updateProjectVaultPolicy(database, {
    projectId,
    appDataRoot,
    locationMode: "project-owned",
    projectOwnedOptIn: true,
    gitTrackingEnabled: false,
  })
  return scaffoldProjectVault(database, {
    projectId,
    appDataRoot,
    sections: ["index"],
  })
}

async function waitForLine(child: ReturnType<typeof spawn>, expected: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let stdout = ""
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
      if (stdout.includes(expected)) resolvePromise()
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (!stdout.includes(expected)) reject(new Error(`Lock holder exited early with ${code}.`))
    })
  })
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Lock holder exited with ${child.exitCode}.`)
    return
  }
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Lock holder exited with ${code}.`))
    })
  })
}

async function waitForTermination(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject)
    child.once("close", () => resolvePromise())
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function initRepository(root: string): void {
  git(root, ["init", "-q"])
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function getCommonExcludePath(root: string): string {
  return resolve(
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "info",
    "exclude",
  )
}

function expectGitIgnored(root: string, relativePath: string): void {
  expect(() =>
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", relativePath], {
      cwd: root,
      stdio: "ignore",
    }),
  ).not.toThrow()
}
