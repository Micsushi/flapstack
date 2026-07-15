import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  SaveUsageExplorerView,
  UsageExplorerView,
} from "../../../shared/advanced-usage-explorer"
import {
  saveUsageExplorerViewSchema,
  usageExplorerViewSchema,
} from "../../../shared/advanced-usage-explorer"

const require = createRequire(import.meta.url)
const fileName = "advanced-usage-views.json"

export function listUsageExplorerViews(): UsageExplorerView[] {
  const path = viewsPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((value) => {
        const result = usageExplorerViewSchema.safeParse(value)
        return result.success ? [result.data] : []
      })
      .sort(
        (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
      )
  } catch {
    return []
  }
}

export function saveUsageExplorerView(
  rawInput: SaveUsageExplorerView,
  nowMs = Date.now(),
): UsageExplorerView {
  const input = saveUsageExplorerViewSchema.parse(rawInput)
  const views = listUsageExplorerViews()
  const existing = input.id ? views.find((view) => view.id === input.id) : undefined
  if (input.id && !existing) throw new Error("Saved usage view no longer exists.")
  const view = usageExplorerViewSchema.parse({
    id: existing?.id ?? randomUUID(),
    name: input.name,
    query: input.query,
    metric: input.metric,
    createdAt: existing?.createdAt ?? nowMs,
    updatedAt: nowMs,
  })
  writeViews([...views.filter((item) => item.id !== view.id), view])
  return view
}

export function deleteUsageExplorerView(id: string): { deleted: boolean } {
  const views = listUsageExplorerViews()
  const next = views.filter((view) => view.id !== id)
  if (next.length === views.length) return { deleted: false }
  writeViews(next)
  return { deleted: true }
}

function writeViews(views: UsageExplorerView[]): void {
  const path = viewsPath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(views, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
}

function viewsPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) return join(overrideDir, fileName)
  return join(getElectronUserDataPath(), "data", fileName)
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const path = electron.app?.getPath("userData")
    if (path) return path
  } catch {
    // Tests and daemon use the explicit config directory or local fallback.
  }
  return join(process.cwd(), ".flapstack")
}
