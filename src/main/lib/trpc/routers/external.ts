import { clipboard, shell } from "electron"
import { openExternalSafe } from "../../open-external"
import { execFileSync, spawn } from "node:child_process"
import * as os from "node:os"
import * as path from "node:path"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import { APP_META, externalAppSchema, type ExternalApp } from "../../../../shared/external-apps"
import {
  editorCommandsForPlatform,
  editorFileArgs,
  editorLookupCommand,
} from "../../external/editor-file-args"

function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1))
  }
  return filePath
}

function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    })
    child.unref()
    child.on("error", reject)
    // Resolve immediately - we just need to launch the app
    resolve()
  })
}

function openPathInApp(app: ExternalApp, targetPath: string): Promise<void> {
  const expandedPath = expandTilde(targetPath)

  if (app === "finder") {
    shell.showItemInFolder(expandedPath)
    return Promise.resolve()
  }

  const meta = APP_META[app]
  return spawnAsync("open", ["-a", meta.macAppName, expandedPath])
}

/**
 * External router for shell operations (open in finder, open in editor, etc.)
 */
export const externalRouter = router({
  openInFinder: publicProcedure.input(z.string()).mutation(async ({ input: inputPath }) => {
    const expandedPath = expandTilde(inputPath)
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
      const { cwd } = input
      const filePath = input.path.startsWith("~")
        ? input.path.replace("~", os.homedir())
        : input.path

      // Try common code editors in order of preference
      const editors = editorCommandsForPlatform(process.platform).map((cmd) => ({
        cmd,
        args: editorFileArgs(cmd, filePath, input.line, input.column),
      }))

      for (const editor of editors) {
        try {
          // Check if the command exists first
          const lookup = editorLookupCommand(process.platform, editor.cmd)
          execFileSync(lookup.command, lookup.args, { stdio: "ignore" })
          const child = spawn(editor.cmd, editor.args, {
            cwd: cwd || undefined,
            detached: true,
            stdio: "ignore",
          })
          child.unref()
          return { success: true, editor: editor.cmd }
        } catch {
          // Try next editor
          continue
        }
      }

      // Fallback: use shell.openPath which opens with default app
      await shell.openPath(filePath)
      return { success: true, editor: "default" }
    }),

  openExternal: publicProcedure.input(z.string()).mutation(async ({ input: url }) => {
    const opened = await openExternalSafe(url)
    return { success: opened }
  }),
})
