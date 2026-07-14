import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import type { ChokidarOptions, FSWatcher } from "chokidar"
import type {
  PlanCandidate,
  PlanCandidateKind,
  PlanParseIssue,
  PlanSourceRefreshEvent,
  PlanSourceSnapshot,
  PlanSourceType,
  ProjectPlanSnapshot,
} from "../../shared/plan-sources"

const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES_PER_SOURCE = 100
const MAX_SOURCES = 100
const MAX_SELECTED_MARKDOWN_SOURCES = 100
const MAX_CANDIDATES_PER_SOURCE = 500
const MAX_SCAN_DEPTH = 5

const MARKDOWN_LIMITATION =
  "Markdown parsing is limited to ATX headings and checklist items outside fenced code blocks."
const OPENSPEC_LIMITATION =
  "OpenSpec parsing reads proposal.md, specs/**/spec.md, and tasks.md; design and arbitrary files are not interpreted."

export interface ProjectPlanSourceConfig {
  projectId: string
  rootPath: string
  markdownPaths: string[]
}

export interface ReadPlanSourceOptions {
  expectedFingerprints?: Readonly<Record<string, string>>
}

export class PlanSourcePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlanSourcePathError"
  }
}

interface SourceFile {
  path: string
  content: string
}

interface CandidateDraft {
  kind: PlanCandidateKind
  title: string
  body: string | null
  path: string
  line: number
  depth: number
  parentKey: string | null
  structuralKey: string
  completed: boolean | null
}

interface ParsedSource {
  candidates: CandidateDraft[]
  errors: PlanParseIssue[]
  limitations: string[]
}

export async function readProjectPlanSources(
  config: ProjectPlanSourceConfig,
  options: ReadPlanSourceOptions = {},
): Promise<ProjectPlanSnapshot> {
  const rootPath = await assertRealRoot(config.rootPath)
  const sources: PlanSourceSnapshot[] = []
  const limitations: string[] = []

  const openSpecSources = await discoverOpenSpecSources(rootPath)
  if (openSpecSources.length >= MAX_SOURCES) {
    limitations.push(`OpenSpec discovery is limited to ${MAX_SOURCES} changes per project.`)
  }
  for (const sourcePath of openSpecSources.slice(0, MAX_SOURCES)) {
    sources.push(await readOpenSpecSource(rootPath, sourcePath, options.expectedFingerprints ?? {}))
  }

  const markdownPaths = normalizeMarkdownPaths(config.markdownPaths)
  if (markdownPaths.length > MAX_SELECTED_MARKDOWN_SOURCES) {
    limitations.push(
      `Selected Markdown discovery is limited to ${MAX_SELECTED_MARKDOWN_SOURCES} files per project.`,
    )
  }
  for (const sourcePath of markdownPaths.slice(0, MAX_SELECTED_MARKDOWN_SOURCES)) {
    sources.push(await readMarkdownSource(rootPath, sourcePath, options.expectedFingerprints ?? {}))
  }

  sources.sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type))
  return {
    projectId: config.projectId,
    rootPath,
    fingerprint: hash(sources.map((source) => `${source.id}\0${source.fingerprint}`).join("\0")),
    sources,
    limitations,
  }
}

export async function validateMarkdownPlanSource(
  rootPath: string,
  rawPath: string,
): Promise<string> {
  const canonicalRoot = await assertRealRoot(rootPath)
  const sourcePath = normalizeRelativeSourcePath(rawPath)
  if (!sourcePath.toLowerCase().endsWith(".md")) {
    throw new PlanSourcePathError("Plan source must be a Markdown file")
  }
  await readSafeFile(canonicalRoot, sourcePath)
  return sourcePath
}

async function discoverOpenSpecSources(rootPath: string): Promise<string[]> {
  const changesPath = "openspec/changes"
  const absoluteChangesPath = join(rootPath, changesPath)
  try {
    const info = await lstat(absoluteChangesPath)
    if (info.isSymbolicLink() || !info.isDirectory()) return []
    const entries = await readdir(absoluteChangesPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== "archive")
      .map((entry) => `${changesPath}/${entry.name}`)
      .sort()
  } catch (error) {
    if (isMissing(error)) return []
    return []
  }
}

async function readOpenSpecSource(
  rootPath: string,
  sourcePath: string,
  expectedFingerprints: Readonly<Record<string, string>>,
): Promise<PlanSourceSnapshot> {
  const sourceId = stableId("source", "openspec", sourcePath)
  const errors: PlanParseIssue[] = []
  const files: SourceFile[] = []
  for (const filePath of [`${sourcePath}/proposal.md`, `${sourcePath}/tasks.md`]) {
    const file = await tryReadSourceFile(rootPath, filePath, errors)
    if (file) files.push(file)
  }
  files.push(...(await readSpecFiles(rootPath, sourcePath, errors)))

  const parsed: ParsedSource = {
    candidates: [],
    errors,
    limitations: [OPENSPEC_LIMITATION],
  }
  const proposal = files.find((file) => file.path.endsWith("/proposal.md"))
  const tasks = files.find((file) => file.path.endsWith("/tasks.md"))
  if (!proposal) {
    parsed.errors.push(issue("missing", sourcePath, "OpenSpec source has no readable proposal.md."))
  } else {
    mergeParsed(parsed, parseOpenSpecProposal(proposal))
  }
  for (const spec of files.filter((file) => file.path.includes("/specs/"))) {
    mergeParsed(parsed, parseOpenSpecSpec(spec))
  }
  if (tasks) mergeParsed(parsed, parseOpenSpecTasks(tasks))
  else parsed.limitations.push("No readable tasks.md checklist was found.")

  return finalizeSource("openspec", sourcePath, sourceId, files, parsed, expectedFingerprints)
}

async function readMarkdownSource(
  rootPath: string,
  sourcePath: string,
  expectedFingerprints: Readonly<Record<string, string>>,
): Promise<PlanSourceSnapshot> {
  const sourceId = stableId("source", "markdown", sourcePath)
  const errors: PlanParseIssue[] = []
  const file = await tryReadSourceFile(rootPath, sourcePath, errors)
  const parsed: ParsedSource = {
    candidates: [],
    errors,
    limitations: [MARKDOWN_LIMITATION],
  }
  if (file) mergeParsed(parsed, parseMarkdown(file, "heading", "checklist"))
  return finalizeSource(
    "markdown",
    sourcePath,
    sourceId,
    file ? [file] : [],
    parsed,
    expectedFingerprints,
  )
}

async function readSpecFiles(
  rootPath: string,
  sourcePath: string,
  errors: PlanParseIssue[],
): Promise<SourceFile[]> {
  const result: SourceFile[] = []
  const specsRoot = `${sourcePath}/specs`
  const visit = async (relativeDirectory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || result.length >= MAX_FILES_PER_SOURCE) return
    let entries
    try {
      const directory = await assertSafeDirectory(rootPath, relativeDirectory)
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (!isMissing(error)) {
        errors.push(issueForError(error, relativeDirectory))
      }
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (result.length >= MAX_FILES_PER_SOURCE) break
      const entryPath = `${relativeDirectory}/${entry.name}`
      if (entry.isSymbolicLink()) {
        errors.push(issue("symlink", entryPath, "Symbolic links are not read as plan sources."))
      } else if (entry.isDirectory()) {
        await visit(entryPath, depth + 1)
      } else if (entry.isFile() && entry.name === "spec.md") {
        const file = await tryReadSourceFile(rootPath, entryPath, errors)
        if (file) result.push(file)
      }
    }
  }
  await visit(specsRoot, 0)
  if (result.length >= MAX_FILES_PER_SOURCE) {
    errors.push(
      issue(
        "bounded",
        specsRoot,
        `OpenSpec parsing is limited to ${MAX_FILES_PER_SOURCE} files per source.`,
      ),
    )
  }
  return result
}

function parseOpenSpecProposal(file: SourceFile): ParsedSource {
  const parsed = parseMarkdown(file, "section", "task")
  const title = parsed.candidates.find((candidate) => candidate.depth === 1)
  if (!title) {
    parsed.errors.push(issue("invalid-format", file.path, "Proposal has no level-one title."))
  } else {
    title.kind = "proposal"
  }
  return parsed
}

function parseOpenSpecSpec(file: SourceFile): ParsedSource {
  const result: ParsedSource = { candidates: [], errors: [], limitations: [] }
  const lines = file.content.split(/\r?\n/)
  const requirementKeys: string[] = []
  let currentRequirement: { key: string; title: string; line: number; scenarios: number } | null =
    null
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const requirement = raw.match(/^###\s+Requirement:\s*(.+?)\s*#*\s*$/i)
    if (requirement) {
      if (currentRequirement?.scenarios === 0) {
        result.errors.push(
          issue(
            "invalid-format",
            file.path,
            `Requirement \"${currentRequirement.title}\" has no scenario.`,
            currentRequirement.line,
          ),
        )
      }
      const title = requirement[1]!.trim()
      const key = structuralKey("requirement", [file.path, title], requirementKeys)
      currentRequirement = { key, title, line: index + 1, scenarios: 0 }
      result.candidates.push({
        kind: "requirement",
        title,
        body: collectBody(lines, index + 1, /^#{1,4}\s/),
        path: file.path,
        line: index + 1,
        depth: 1,
        parentKey: null,
        structuralKey: key,
        completed: null,
      })
      continue
    }
    const scenario = raw.match(/^####\s+Scenario:\s*(.+?)\s*#*\s*$/i)
    if (scenario) {
      if (!currentRequirement) {
        result.errors.push(
          issue("invalid-format", file.path, "Scenario appears before a requirement.", index + 1),
        )
        continue
      }
      currentRequirement.scenarios += 1
      const title = scenario[1]!.trim()
      const key = structuralKey(
        "scenario",
        [file.path, currentRequirement.key, title],
        requirementKeys,
      )
      result.candidates.push({
        kind: "scenario",
        title,
        body: collectBody(lines, index + 1, /^#{1,4}\s/),
        path: file.path,
        line: index + 1,
        depth: 2,
        parentKey: currentRequirement.key,
        structuralKey: key,
        completed: null,
      })
    }
  }
  if (currentRequirement?.scenarios === 0) {
    result.errors.push(
      issue(
        "invalid-format",
        file.path,
        `Requirement \"${currentRequirement.title}\" has no scenario.`,
        currentRequirement.line,
      ),
    )
  }
  if (inFence) {
    result.errors.push(issue("invalid-format", file.path, "Markdown fence is not closed."))
  }
  if (!result.candidates.some((candidate) => candidate.kind === "requirement")) {
    result.errors.push(issue("invalid-format", file.path, "Spec has no requirement headings."))
  }
  return result
}

function parseOpenSpecTasks(file: SourceFile): ParsedSource {
  const parsed = parseMarkdown(file, "section", "task")
  const candidatesByKey = new Map(
    parsed.candidates.map((candidate) => [candidate.structuralKey, candidate]),
  )
  const lines = file.content.split(/\r?\n/)
  for (const candidate of parsed.candidates) {
    if (candidate.kind !== "task" || !/^completion\s*:/i.test(candidate.title)) continue
    const parent = candidate.parentKey ? candidatesByKey.get(candidate.parentKey) : undefined
    if (parent) candidate.title = parent.title
    candidate.body = collectBody(lines, candidate.line, /^#{1,6}\s|^\s*[-*+]\s+\[[ xX]\]\s+/)
  }
  if (!parsed.candidates.some((candidate) => candidate.kind === "task")) {
    parsed.errors.push(issue("invalid-format", file.path, "Tasks file has no checklist items."))
  }
  return parsed
}

function parseMarkdown(
  file: SourceFile,
  headingKind: "heading" | "section",
  checklistKind: "checklist" | "task",
): ParsedSource {
  const result: ParsedSource = { candidates: [], errors: [], limitations: [] }
  const lines = file.content.split(/\r?\n/)
  const headingStack: Array<{ depth: number; key: string; title: string }> = []
  const usedKeys: string[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    if (result.candidates.length >= MAX_CANDIDATES_PER_SOURCE) {
      result.errors.push(
        issue(
          "bounded",
          file.path,
          `Parsing is limited to ${MAX_CANDIDATES_PER_SOURCE} candidates per source.`,
          index + 1,
        ),
      )
      break
    }
    const raw = lines[index]!
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const depth = heading[1]!.length
      const title = heading[2]!.trim()
      while (headingStack.at(-1)?.depth && headingStack.at(-1)!.depth >= depth) {
        headingStack.pop()
      }
      const parent = headingStack.at(-1) ?? null
      const key = structuralKey(
        headingKind,
        [file.path, ...headingStack.map((entry) => entry.title), title],
        usedKeys,
      )
      result.candidates.push({
        kind: headingKind,
        title,
        body: collectBody(lines, index + 1, /^#{1,6}\s|^\s*[-*+]\s+\[[ xX]\]\s+/),
        path: file.path,
        line: index + 1,
        depth,
        parentKey: parent?.key ?? null,
        structuralKey: key,
        completed: null,
      })
      headingStack.push({ depth, key, title })
      continue
    }
    const checklist = raw.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/)
    if (checklist) {
      const parent = headingStack.at(-1) ?? null
      const title = checklist[2]!.trim()
      const key = structuralKey(checklistKind, [file.path, parent?.key ?? "root", title], usedKeys)
      result.candidates.push({
        kind: checklistKind,
        title,
        body: null,
        path: file.path,
        line: index + 1,
        depth: (parent?.depth ?? 0) + 1,
        parentKey: parent?.key ?? null,
        structuralKey: key,
        completed: checklist[1]!.toLowerCase() === "x",
      })
    }
  }
  if (inFence) {
    result.errors.push(issue("invalid-format", file.path, "Markdown fence is not closed."))
  }
  return result
}

function finalizeSource(
  type: PlanSourceType,
  sourcePath: string,
  sourceId: string,
  files: SourceFile[],
  parsed: ParsedSource,
  expectedFingerprints: Readonly<Record<string, string>>,
): PlanSourceSnapshot {
  const fingerprint = hash(
    files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => `${relative(sourcePath, file.path)}\0${file.content}`)
      .join("\0"),
  )
  const candidateIds = new Map<string, string>()
  for (const draft of parsed.candidates) {
    candidateIds.set(draft.structuralKey, stableId("candidate", sourceId, draft.structuralKey))
  }
  const candidates: PlanCandidate[] = parsed.candidates.map((draft) => ({
    id: candidateIds.get(draft.structuralKey)!,
    fingerprint: hash(
      JSON.stringify({
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        completed: draft.completed,
      }),
    ),
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    path: draft.path,
    line: draft.line,
    depth: draft.depth,
    parentId: draft.parentKey ? (candidateIds.get(draft.parentKey) ?? null) : null,
    completed: draft.completed,
  }))
  const stale = Boolean(
    expectedFingerprints[sourceId] && expectedFingerprints[sourceId] !== fingerprint,
  )
  return {
    id: sourceId,
    type,
    path: sourcePath,
    fingerprint,
    status: parsed.errors.length > 0 ? "malformed" : stale ? "stale" : "current",
    stale,
    candidates,
    limitations: [...new Set(parsed.limitations)],
    errors: parsed.errors,
  }
}

async function tryReadSourceFile(
  rootPath: string,
  sourcePath: string,
  errors: PlanParseIssue[],
): Promise<SourceFile | null> {
  try {
    return { path: sourcePath, content: await readSafeFile(rootPath, sourcePath) }
  } catch (error) {
    errors.push(issueForError(error, sourcePath))
    return null
  }
}

async function readSafeFile(rootPath: string, sourcePath: string): Promise<string> {
  const normalizedPath = normalizeRelativeSourcePath(sourcePath)
  const absolutePath = resolve(rootPath, normalizedPath)
  assertInsideRoot(rootPath, absolutePath)
  await assertNoSymlinkComponents(rootPath, normalizedPath, false)
  const info = await lstat(absolutePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new PlanSourcePathError("Plan source must be a real file")
  }
  if (info.size > MAX_FILE_BYTES) {
    const error = new PlanSourcePathError(
      `Plan source exceeds the ${MAX_FILE_BYTES}-byte read limit`,
    )
    error.name = "PlanSourceBoundedError"
    throw error
  }
  const canonicalPath = await realpath(absolutePath)
  assertInsideRoot(rootPath, canonicalPath)
  return readFile(canonicalPath, "utf8")
}

async function assertSafeDirectory(rootPath: string, sourcePath: string): Promise<string> {
  const normalizedPath = normalizeRelativeSourcePath(sourcePath)
  const absolutePath = resolve(rootPath, normalizedPath)
  assertInsideRoot(rootPath, absolutePath)
  await assertNoSymlinkComponents(rootPath, normalizedPath, true)
  const info = await lstat(absolutePath)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PlanSourcePathError("Plan source parent must be a real directory")
  }
  return absolutePath
}

async function assertNoSymlinkComponents(
  rootPath: string,
  sourcePath: string,
  includeFinalDirectory: boolean,
): Promise<void> {
  const segments = sourcePath.split(sep)
  const lastIndex = includeFinalDirectory ? segments.length : segments.length - 1
  let current = rootPath
  for (let index = 0; index < lastIndex; index += 1) {
    current = join(current, segments[index]!)
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new PlanSourcePathError("Plan source path contains a symbolic link or non-directory")
    }
  }
}

async function assertRealRoot(rootPath: string): Promise<string> {
  const lexicalRoot = resolve(rootPath)
  const info = await lstat(lexicalRoot)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PlanSourcePathError("Registered project root must be a real directory")
  }
  return realpath(lexicalRoot)
}

function normalizeRelativeSourcePath(sourcePath: string): string {
  if (!sourcePath || sourcePath.includes("\0") || isAbsolute(sourcePath)) {
    throw new PlanSourcePathError("Plan source path must be a non-empty relative path")
  }
  const normalizedPath = normalize(sourcePath)
  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith(`..${sep}`)) {
    throw new PlanSourcePathError("Plan source path escapes the registered project root")
  }
  return normalizedPath
}

function normalizeMarkdownPaths(sourcePaths: string[]): string[] {
  return [...new Set(sourcePaths.map(normalizeRelativeSourcePath))].sort()
}

function assertInsideRoot(rootPath: string, targetPath: string): void {
  const relativePath = relative(rootPath, targetPath)
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new PlanSourcePathError("Plan source path escapes the registered project root")
  }
}

function collectBody(lines: string[], start: number, stop: RegExp): string | null {
  const body: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!
    if (stop.test(line)) break
    body.push(line)
  }
  const value = body.join("\n").trim()
  return value || null
}

function structuralKey(kind: string, parts: string[], usedKeys: string[]): string {
  const base = `${kind}:${parts.map(normalizeKeyPart).join("/")}`
  const occurrence = usedKeys.filter((key) => key === base || key.startsWith(`${base}#`)).length
  const key = occurrence === 0 ? base : `${base}#${occurrence + 1}`
  usedKeys.push(key)
  return key
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function stableId(...parts: string[]): string {
  return `plan_${hash(parts.join("\0")).slice(0, 32)}`
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function issue(
  code: PlanParseIssue["code"],
  path: string,
  message: string,
  line?: number,
): PlanParseIssue {
  return { code, path, message, ...(line === undefined ? {} : { line }) }
}

function issueForError(error: unknown, path: string): PlanParseIssue {
  const message = error instanceof Error ? error.message : String(error)
  if (isMissing(error)) return issue("missing", path, "Plan source does not exist.")
  if (error instanceof PlanSourcePathError) {
    return issue(error.name === "PlanSourceBoundedError" ? "bounded" : "symlink", path, message)
  }
  return issue("read-failed", path, message)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function mergeParsed(target: ParsedSource, source: ParsedSource): void {
  target.candidates.push(...source.candidates)
  target.errors.push(...source.errors)
  target.limitations.push(...source.limitations)
}

export interface PlanSourceWatchAdapter {
  on(event: "all", listener: (eventName: string, path: string) => void): this
  on(event: "error", listener: (error: unknown) => void): this
  close(): Promise<void>
}

export type PlanSourceWatchFactory = (
  paths: string[],
  options: ChokidarOptions,
) => PlanSourceWatchAdapter

export interface PlanSourceWatcherOptions {
  loadConfig: () => Promise<ProjectPlanSourceConfig> | ProjectPlanSourceConfig
  onRefresh: (event: PlanSourceRefreshEvent) => void
  onError?: (error: Error) => void
  debounceMs?: number
  watchFactory?: PlanSourceWatchFactory
}

export class PlanSourceRefreshWatcher {
  private watcher: PlanSourceWatchAdapter | null = null
  private timer: NodeJS.Timeout | null = null
  private changedPaths = new Set<string>()
  private fingerprints: Record<string, string> = {}
  private disposed = false

  constructor(private readonly options: PlanSourceWatcherOptions) {}

  async start(): Promise<ProjectPlanSnapshot> {
    if (this.disposed || this.watcher)
      throw new Error("Plan source watcher is already closed or started")
    const config = await this.options.loadConfig()
    const snapshot = await readProjectPlanSources(config)
    this.fingerprints = Object.fromEntries(
      snapshot.sources.map((source) => [source.id, source.fingerprint]),
    )
    const root = snapshot.rootPath
    const paths = [
      join(root, "openspec", "changes"),
      ...normalizeMarkdownPaths(config.markdownPaths)
        .slice(0, MAX_SELECTED_MARKDOWN_SOURCES)
        .map((sourcePath) => join(root, sourcePath)),
    ]
    const watchFactory = this.options.watchFactory ?? (await defaultWatchFactory())
    const watcher = watchFactory(paths, {
      followSymlinks: false,
      ignoreInitial: true,
      persistent: true,
      depth: MAX_SCAN_DEPTH + 3,
    })
    watcher.on("all", (_eventName, changedPath) => {
      this.changedPaths.add(changedPath)
      this.scheduleRefresh()
    })
    watcher.on("error", (error) => this.reportError(error))
    if (this.disposed) await watcher.close()
    else this.watcher = watcher
    return snapshot
  }

  private scheduleRefresh(): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), this.options.debounceMs ?? 75)
  }

  private async refresh(): Promise<void> {
    this.timer = null
    if (this.disposed) return
    const changedPaths = [...this.changedPaths].sort()
    this.changedPaths.clear()
    try {
      const config = await this.options.loadConfig()
      const snapshot = await readProjectPlanSources(config, {
        expectedFingerprints: this.fingerprints,
      })
      this.options.onRefresh({
        type: "refresh-required",
        projectId: config.projectId,
        changedPaths,
        snapshot,
      })
    } catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
  }

  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.watcher?.close()
    this.watcher = null
  }
}

async function defaultWatchFactory(): Promise<PlanSourceWatchFactory> {
  const { watch } = await import("chokidar")
  return (paths, options) => watch(paths, options) as FSWatcher
}
