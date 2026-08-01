import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { isAbsolute, normalize, resolve } from "node:path"
import * as schema from "../db/schema"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"

type OpenUri = (uri: string) => Promise<void>

export type ObsidianOpenResult =
  | { status: "opened"; path: string; uri: string }
  | { status: "unavailable"; path: string; canReveal: true; canCopyPath: true }

export function buildObsidianOpenUri(rootPath: string): string {
  if (!isAbsolute(rootPath)) throw new Error("Obsidian vault path must be absolute.")
  if (/[\u0000-\u001f\u007f]/u.test(rootPath)) {
    throw new Error("Obsidian vault path contains control characters.")
  }
  if (normalize(rootPath) !== rootPath || resolve(rootPath) !== rootPath) {
    throw new Error("Obsidian vault path must be canonical.")
  }
  const uri = new URL("obsidian://open")
  uri.searchParams.set("path", rootPath)
  return uri.toString()
}

export async function openProjectVaultInObsidian(
  database: Database.Database | object,
  projectId: string,
  openUri: OpenUri = defaultOpenUri,
): Promise<ObsidianOpenResult> {
  const sqlite = rawClient(database)
  const row = sqlite
    .prepare("SELECT root_path rootPath FROM project_vaults WHERE project_id = ?")
    .get(projectId) as { rootPath: string } | undefined
  if (!row) throw new Error("Project vault is not scaffolded.")
  const path = assertRegisteredFilesystemRoot(
    row.rootPath,
    drizzle(sqlite, { schema }),
  ).canonicalPath
  const uri = buildObsidianOpenUri(path)
  try {
    await openUri(uri)
    return { status: "opened", path, uri }
  } catch {
    return { status: "unavailable", path, canReveal: true, canCopyPath: true }
  }
}

async function defaultOpenUri(uri: string): Promise<void> {
  const { shell } = await import("electron")
  await shell.openExternal(uri)
}

function rawClient(database: Database.Database | object): Database.Database {
  return "prepare" in database
    ? (database as Database.Database)
    : (database as { $client: Database.Database }).$client
}
