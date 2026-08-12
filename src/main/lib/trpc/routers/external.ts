import { clipboard, shell } from "electron"
import { isExecutableExternalPath, openExternalSafe } from "../../open-external"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import {
  EXTERNAL_APPS,
  externalAppSchema,
  type ExternalApp,
} from "../../../../shared/external-apps"
import {
  assertOpenPathSucceeded,
  getExternalAppProbe,
  getPlatformFolderLabel,
  resolveExternalAppLaunch,
  spawnExternalCommand,
} from "../../external/app-launch"
import {
  editorCommandsForPlatform,
  editorFileArgs,
  editorLookupCommand,
} from "../../external/editor-file-args"
import { getDatabase, chats, projects } from "../../db"
import { assertRegisteredWorktree, PathValidationError } from "../../git/security/path-validation"

function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1))
  }
  return filePath
}

function resolveRegisteredExternalTarget(targetPath: string): string {
  const resolved = path.resolve(expandTilde(targetPath))
  const canonicalTarget = existsSync(resolved)
    ? realpathSync(resolved)
    : path.join(realpathSync(path.dirname(resolved)), path.basename(resolved))
  const db = getDatabase()
  const roots = new Set([
    ...db
      .select({ path: projects.path })
      .from(projects)
      .all()
      .map((row) => row.path),
    ...db
      .select({ path: chats.worktreePath })
      .from(chats)
      .all()
      .flatMap((row) => (row.path ? [row.path] : [])),
  ])

  for (const rootPath of roots) {
    try {
      const root = assertRegisteredWorktree(rootPath)
      const relative = path.relative(root.canonicalPath, canonicalTarget)
      if (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      ) {
        return canonicalTarget
      }
    } catch {
      // Stale registrations do not authorize access.
    }
  }

  throw new PathValidationError("Path is outside registered project roots", "INVALID_TARGET")
}

function assertSafeExternalTarget(targetPath: string): string {
  const resolved = resolveRegisteredExternalTarget(targetPath)
  if (isExecutableExternalPath(resolved)) {
    throw new PathValidationError(
      "Executable files cannot be opened through this action",
      "INVALID_TARGET",
    )
  }
  return resolved
}

function openPathInApp(app: ExternalApp, targetPath: string): Promise<void> {
  const expandedPath = assertSafeExternalTarget(targetPath)
  const launch = resolveExternalAppLaunch(process.platform, app, expandedPath)
  if (launch.kind === "reveal") shell.showItemInFolder(launch.path)
  else if (launch.kind === "default")
    return shell
      .openPath(launch.path)
      .then((result) => assertOpenPathSucceeded(result, launch.path))
  else {
    return spawnExternalCommand(process.platform, launch.command, launch.args).catch(() =>
      shell.openPath(expandedPath).then((result) => assertOpenPathSucceeded(result, expandedPath)),
    )
  }
  return Promise.resolve()
}

/**
 * External router for shell operations (open in finder, open in editor, etc.)
 */
export const externalRouter = router({
  listAvailableApps: publicProcedure.query(() => {
    const apps = EXTERNAL_APPS.filter((app) => {
      if (app === "finder") return true
      const probe = getExternalAppProbe(process.platform, app)
      if (!probe) return false
      try {
        execFileSync(probe.command, probe.args, {
          stdio: "ignore",
          windowsHide: true,
        })
        return true
      } catch {
        return false
      }
    })
    return {
      platform: process.platform,
      folderLabel: getPlatformFolderLabel(process.platform),
      apps,
    }
  }),

  openInFinder: publicProcedure.input(z.string()).mutation(async ({ input: inputPath }) => {
    const expandedPath = resolveRegisteredExternalTarget(inputPath)
    shell.showItemInFolder(expandedPath)
    return { success: true }
  }),

  openInApp: publicProcedure
    .input(
      z.object({
        path: z.string(),
        app: externalAppSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await openPathInApp(input.app, input.path)
      return { success: true }
    }),

  copyPath: publicProcedure.input(z.string()).mutation(({ input: inputPath }) => {
    clipboard.writeText(inputPath)
    return { success: true }
  }),

  openFileInEditor: publicProcedure
    .input(
      z.object({
        path: z.string(),
        cwd: z.string().optional(),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const filePath = assertSafeExternalTarget(input.path)
      const safeCwd = input.cwd ? resolveRegisteredExternalTarget(input.cwd) : undefined

      // Try common code editors in order of preference
      const editors = editorCommandsForPlatform(process.platform).map((cmd) => ({
        cmd,
        args: editorFileArgs(cmd, filePath, input.line, input.column),
      }))

      for (const editor of editors) {
        try {
          // Check if the command exists first
          const lookup = editorLookupCommand(process.platform, editor.cmd)
          execFileSync(lookup.command, lookup.args, { stdio: "ignore", windowsHide: true })
          await spawnExternalCommand(process.platform, editor.cmd, editor.args, {
            cwd: safeCwd,
          })
          return { success: true, editor: editor.cmd }
        } catch {
          // Try next editor
          continue
        }
      }

      // Fallback: use shell.openPath which opens with default app
      assertOpenPathSucceeded(await shell.openPath(filePath), filePath)
      return { success: true, editor: "default" }
    }),

  openExternal: publicProcedure.input(z.string()).mutation(async ({ input: url }) => {
    const opened = await openExternalSafe(url)
    return { success: opened }
  }),
})
