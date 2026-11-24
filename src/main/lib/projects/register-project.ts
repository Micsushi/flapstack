import { basename } from "node:path"
import { eq } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { getGitRemoteInfo } from "../git/remote-info"
import { bindFilesystemRootIdentity } from "../git/security/path-validation"
import { getPermissionPreferences } from "../permissions"
import { findProjectByCanonicalPath, resolveCanonicalProjectPath } from "./project-path"

export async function registerProjectDirectory(
  database: BetterSQLite3Database<typeof schema>,
  path: string,
  name?: string,
) {
  const folder = resolveCanonicalProjectPath(path)
  const git = await getGitRemoteInfo(folder)
  const remote = {
    gitRemoteUrl: git.remoteUrl,
    gitProvider: git.provider,
    gitOwner: git.owner,
    gitRepo: git.repo,
  }
  return database.transaction(
    (tx) => {
      const existing = findProjectByCanonicalPath(tx.select().from(schema.projects).all(), folder)
      bindFilesystemRootIdentity(existing?.path ?? folder, tx)
      if (existing) {
        const project = tx
          .update(schema.projects)
          .set({ ...remote, updatedAt: new Date() })
          .where(eq(schema.projects.id, existing.id))
          .returning()
          .get()
        return { project, created: false }
      }
      const prefs = getPermissionPreferences()
      const project = tx
        .insert(schema.projects)
        .values({
          ...remote,
          path: folder,
          name: name ?? basename(folder),
          defaultPermissionMode: prefs.globalDefault,
          defaultCustomPermissions:
            prefs.globalDefault === "custom" ? JSON.stringify(prefs.globalCustomPermissions) : null,
        })
        .returning()
        .get()
      return { project, created: true }
    },
    { behavior: "immediate" },
  )
}
