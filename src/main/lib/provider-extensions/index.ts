import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import matter from "gray-matter"
import { discoverInstalledPlugins } from "../plugins"
import {
  createProviderExtensionManifest,
  providerExtensionId,
  type ProviderExtensionCapabilities,
  type ProviderExtensionKind,
  type ProviderExtensionManifest,
  type ProviderExtensionMutation,
  type ProviderExtensionMutationResult,
  type ProviderExtensionProvider,
  type ProviderExtensionScope,
} from "./contract"

type ExtensionRoot = {
  provider: ProviderExtensionProvider
  kind: ProviderExtensionKind
  source: "user" | "project"
  root: string
  shape: "skill-directories" | "markdown-files" | "plugin-files"
  capabilities: ProviderExtensionCapabilities
  limitations: string[]
}

const MAX_ROOT_ENTRIES = 1_000
const MAX_EXTENSION_FILE_BYTES = 1_000_000

const writable = (runtime: ProviderExtensionCapabilities["runtime"] = "next-run") => ({
  discovery: "supported" as const,
  create: true,
  update: true,
  delete: true,
  runtime,
})

const readOnly = (
  discovery: ProviderExtensionCapabilities["discovery"] = "supported",
  runtime: ProviderExtensionCapabilities["runtime"] = "read-only",
) => ({ discovery, create: false, update: false, delete: false, runtime })

function roots(home: string, cwd?: string): ExtensionRoot[] {
  const project = cwd ? path.resolve(cwd) : null
  const list: ExtensionRoot[] = [
    root("claude", "skill", "user", path.join(home, ".claude", "skills"), "skill-directories"),
    root("claude", "command", "user", path.join(home, ".claude", "commands"), "markdown-files"),
    root("claude", "custom-agent", "user", path.join(home, ".claude", "agents"), "markdown-files"),
    root("codex", "skill", "user", path.join(home, ".agents", "skills"), "skill-directories"),
    root(
      "codex",
      "skill",
      "user",
      path.join(home, ".codex", "skills"),
      "skill-directories",
      readOnly("compatibility", "unknown"),
      [
        "Compatibility path; current Codex docs name $HOME/.agents/skills as the writable user path.",
      ],
    ),
    root(
      "opencode",
      "skill",
      "user",
      path.join(home, ".config", "opencode", "skills"),
      "skill-directories",
      readOnly(),
      [
        "Flapstack sidecars isolate global OpenCode config; user-global items are not consumed by managed runs.",
      ],
    ),
    root(
      "opencode",
      "command",
      "user",
      path.join(home, ".config", "opencode", "commands"),
      "markdown-files",
      readOnly(),
      [
        "Flapstack sidecars isolate global OpenCode config; user-global items are not consumed by managed runs.",
      ],
    ),
    root(
      "opencode",
      "custom-agent",
      "user",
      path.join(home, ".config", "opencode", "agents"),
      "markdown-files",
      readOnly(),
      [
        "Flapstack sidecars isolate global OpenCode config; user-global items are not consumed by managed runs.",
      ],
    ),
    root(
      "opencode",
      "plugin",
      "user",
      path.join(home, ".config", "opencode", "plugins"),
      "plugin-files",
      readOnly(),
      [
        "Plugin code is inventory-only; Flapstack never executes or mutates untrusted provider plugins.",
      ],
    ),
  ]

  if (project) {
    list.push(
      root(
        "claude",
        "skill",
        "project",
        path.join(project, ".claude", "skills"),
        "skill-directories",
      ),
      root(
        "claude",
        "command",
        "project",
        path.join(project, ".claude", "commands"),
        "markdown-files",
      ),
      root(
        "claude",
        "custom-agent",
        "project",
        path.join(project, ".claude", "agents"),
        "markdown-files",
      ),
      root(
        "codex",
        "skill",
        "project",
        path.join(project, ".agents", "skills"),
        "skill-directories",
      ),
      root(
        "cursor",
        "command",
        "project",
        path.join(project, ".cursor", "commands"),
        "markdown-files",
      ),
      root(
        "opencode",
        "skill",
        "project",
        path.join(project, ".opencode", "skills"),
        "skill-directories",
        readOnly(),
        [
          "Managed OpenCode runs currently disable project config; inventory is not yet injected into the isolated sidecar.",
        ],
      ),
      root(
        "opencode",
        "command",
        "project",
        path.join(project, ".opencode", "commands"),
        "markdown-files",
        readOnly(),
        [
          "Managed OpenCode runs currently disable project config; inventory is not yet injected into the isolated sidecar.",
        ],
      ),
      root(
        "opencode",
        "custom-agent",
        "project",
        path.join(project, ".opencode", "agents"),
        "markdown-files",
        readOnly(),
        [
          "Managed OpenCode runs currently disable project config; inventory is not yet injected into the isolated sidecar.",
        ],
      ),
      root(
        "opencode",
        "plugin",
        "project",
        path.join(project, ".opencode", "plugins"),
        "plugin-files",
        readOnly(),
        [
          "Plugin code is inventory-only; Flapstack never executes or mutates untrusted provider plugins.",
        ],
      ),
    )
  }
  return list
}

function root(
  provider: ProviderExtensionProvider,
  kind: ProviderExtensionKind,
  source: "user" | "project",
  rootPath: string,
  shape: ExtensionRoot["shape"],
  capabilities: ProviderExtensionCapabilities = writable(),
  limitations: string[] = [],
): ExtensionRoot {
  return { provider, kind, source, root: rootPath, shape, capabilities, limitations }
}

export async function discoverProviderExtensions(
  options: {
    cwd?: string
    homeDir?: string
  } = {},
): Promise<ProviderExtensionManifest[]> {
  const home = path.resolve(options.homeDir ?? os.homedir())
  const discovered = await Promise.all(
    roots(home, options.cwd).map(async (entry) => {
      try {
        if (entry.shape === "skill-directories") return await scanSkillRoot(entry)
        return await scanFileRoot(entry)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        return [failureManifest(entry, error)]
      }
    }),
  )
  const mcp = await discoverMcpExtensions({ cwd: options.cwd, homeDir: home })
  const claudePlugins = await discoverClaudePlugins()
  return [...discovered.flat(), ...mcp, ...claudePlugins].sort((a, b) =>
    `${a.provider}:${a.kind}:${a.name}:${a.sourceId}`.localeCompare(
      `${b.provider}:${b.kind}:${b.name}:${b.sourceId}`,
    ),
  )
}

async function discoverClaudePlugins(): Promise<ProviderExtensionManifest[]> {
  try {
    return (await discoverInstalledPlugins()).map((plugin) =>
      createProviderExtensionManifest({
        provider: "claude",
        kind: "plugin",
        source: "plugin",
        sourceId: plugin.source,
        name: plugin.name,
        description: plugin.description ?? "",
        path: plugin.path,
        capabilities: readOnly("supported", "unknown"),
        limitations: [
          "Installed Claude plugin inventory only. Enabled state and mutation remain in the provider plugin manager until runtime evidence is unified.",
        ],
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      createProviderExtensionManifest({
        provider: "claude",
        kind: "plugin",
        source: "plugin",
        sourceId: "claude-plugin-discovery-error",
        name: "Unavailable plugin inventory",
        description: message,
        path: "~/.claude/plugins",
        capabilities: readOnly("unknown", "unknown"),
        limitations: [`Plugin discovery failed: ${message}`],
      }),
    ]
  }
}

async function scanSkillRoot(root: ExtensionRoot): Promise<ProviderExtensionManifest[]> {
  const entries = await fs.readdir(root.root, { withFileTypes: true })
  const manifests: ProviderExtensionManifest[] = []
  for (const entry of entries.slice(0, MAX_ROOT_ENTRIES)) {
    if (!entry.isDirectory() || !safeName(entry.name)) continue
    const file = path.join(root.root, entry.name, "SKILL.md")
    try {
      const manifest = await markdownManifest(root, file, entry.name)
      if (manifest) manifests.push(manifest)
    } catch (error) {
      manifests.push(fileFailureManifest(root, file, entry.name, error))
    }
  }
  if (entries.length > MAX_ROOT_ENTRIES) manifests.push(limitManifest(root, entries.length))
  return manifests
}

async function scanFileRoot(root: ExtensionRoot): Promise<ProviderExtensionManifest[]> {
  const entries = await fs.readdir(root.root, { withFileTypes: true })
  const manifests: ProviderExtensionManifest[] = []
  for (const entry of entries.slice(0, MAX_ROOT_ENTRIES)) {
    if (!entry.isFile() || !safeName(entry.name)) continue
    const extension = path.extname(entry.name).toLowerCase()
    if (root.shape === "markdown-files" && extension !== ".md") continue
    if (root.shape === "plugin-files" && ![".js", ".mjs", ".cjs", ".ts"].includes(extension))
      continue
    const file = path.join(root.root, entry.name)
    try {
      const manifest = await markdownManifest(root, file, path.basename(entry.name, extension))
      if (manifest) manifests.push(manifest)
    } catch (error) {
      manifests.push(fileFailureManifest(root, file, path.basename(entry.name, extension), error))
    }
  }
  if (entries.length > MAX_ROOT_ENTRIES) manifests.push(limitManifest(root, entries.length))
  return manifests
}

async function markdownManifest(
  root: ExtensionRoot,
  file: string,
  fallbackName: string,
): Promise<ProviderExtensionManifest | null> {
  let raw: string
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(file)
    if (stat.size > MAX_EXTENSION_FILE_BYTES) {
      throw new Error(`File exceeds the ${MAX_EXTENSION_FILE_BYTES}-byte discovery limit`)
    }
    raw = await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  let data: Record<string, unknown> = {}
  let content = raw
  if (path.extname(file).toLowerCase() === ".md") {
    const parsed = matter(raw)
    data = parsed.data
    content = parsed.content.trim()
  }
  const sourceId = path.resolve(file)
  return createProviderExtensionManifest({
    provider: root.provider,
    kind: root.kind,
    source: root.source,
    sourceId,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName,
    description: typeof data.description === "string" ? data.description.trim() : "",
    path: displayPath(sourceId, root.source, root.root),
    content,
    updatedAt: stat.mtimeMs,
    capabilities: root.capabilities,
    limitations: root.limitations,
  })
}

function fileFailureManifest(
  root: ExtensionRoot,
  file: string,
  name: string,
  error: unknown,
): ProviderExtensionManifest {
  const message = error instanceof Error ? error.message : String(error)
  return createProviderExtensionManifest({
    provider: root.provider,
    kind: root.kind,
    source: root.source,
    sourceId: `${path.resolve(file)}#parse-error`,
    name,
    description: message,
    path: displayPath(path.resolve(file), root.source, root.root),
    capabilities: readOnly("unknown", "unknown"),
    limitations: [`Provider file could not be parsed safely: ${message}`],
  })
}

function limitManifest(root: ExtensionRoot, total: number): ProviderExtensionManifest {
  return createProviderExtensionManifest({
    provider: root.provider,
    kind: root.kind,
    source: root.source,
    sourceId: `${root.root}#entry-limit`,
    name: `Additional ${root.kind} entries not shown`,
    description: `${total - MAX_ROOT_ENTRIES} entries exceed the bounded discovery limit.`,
    path: root.root,
    capabilities: readOnly("unknown", "unknown"),
    limitations: [`Discovery is limited to ${MAX_ROOT_ENTRIES} entries per provider root.`],
  })
}

async function discoverMcpExtensions(options: {
  cwd?: string
  homeDir: string
}): Promise<ProviderExtensionManifest[]> {
  const configs: Array<{
    provider: ProviderExtensionProvider
    source: "user" | "project"
    file: string
    format: "json" | "toml"
  }> = [
    {
      provider: "claude",
      source: "user",
      file: path.join(options.homeDir, ".claude.json"),
      format: "json",
    },
    {
      provider: "codex",
      source: "user",
      file: path.join(options.homeDir, ".codex", "config.toml"),
      format: "toml",
    },
    {
      provider: "cursor",
      source: "user",
      file: path.join(options.homeDir, ".cursor", "mcp.json"),
      format: "json",
    },
    {
      provider: "opencode",
      source: "user",
      file: path.join(options.homeDir, ".config", "opencode", "opencode.json"),
      format: "json",
    },
  ]
  if (options.cwd) {
    const cwd = path.resolve(options.cwd)
    configs.push(
      { provider: "claude", source: "project", file: path.join(cwd, ".mcp.json"), format: "json" },
      {
        provider: "cursor",
        source: "project",
        file: path.join(cwd, ".cursor", "mcp.json"),
        format: "json",
      },
      {
        provider: "opencode",
        source: "project",
        file: path.join(cwd, "opencode.json"),
        format: "json",
      },
      {
        provider: "codex",
        source: "project",
        file: path.join(cwd, ".codex", "config.toml"),
        format: "toml",
      },
    )
  }
  const groups = await Promise.all(configs.map(discoverMcpConfig))
  return groups.flat()
}

async function discoverMcpConfig(config: {
  provider: ProviderExtensionProvider
  source: "user" | "project"
  file: string
  format: "json" | "toml"
}): Promise<ProviderExtensionManifest[]> {
  let raw: string
  try {
    raw = await fs.readFile(config.file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  let names: string[] = []
  if (config.format === "json") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const candidate = parsed.mcpServers ?? parsed.mcp
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        names = Object.keys(candidate)
      }
    } catch {
      return [mcpFailure(config, "MCP config is not valid JSON; mutation is disabled.")]
    }
  } else {
    names = [...raw.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_.-]+))\]\s*$/gm)].map(
      (match) => (match[1] ?? match[2])!,
    )
  }
  return names.map((name) =>
    createProviderExtensionManifest({
      provider: config.provider,
      kind: "mcp",
      source: config.source,
      sourceId: `${path.resolve(config.file)}#${name}`,
      name,
      description: "Third-party provider MCP configuration",
      path: displayPath(path.resolve(config.file), config.source, path.dirname(config.file)),
      capabilities: readOnly(),
      limitations: [
        "Inventory-only in Provider Extensions. Product app-control and development test-control MCPs are separate identities.",
        "A reserved display name does not grant product or development-control privileges.",
      ],
    }),
  )
}

function mcpFailure(
  config: { provider: ProviderExtensionProvider; source: "user" | "project"; file: string },
  message: string,
): ProviderExtensionManifest {
  return createProviderExtensionManifest({
    provider: config.provider,
    kind: "mcp",
    source: config.source,
    sourceId: `${path.resolve(config.file)}#parse-error`,
    name: "Unreadable MCP configuration",
    description: message,
    path: config.file,
    capabilities: readOnly("unknown", "unknown"),
    limitations: [message],
  })
}

function failureManifest(root: ExtensionRoot, error: unknown): ProviderExtensionManifest {
  const message = error instanceof Error ? error.message : String(error)
  return createProviderExtensionManifest({
    provider: root.provider,
    kind: root.kind,
    source: root.source,
    sourceId: `${root.root}#discovery-error`,
    name: `Unavailable ${root.kind} inventory`,
    description: message,
    path: root.root,
    capabilities: readOnly("unknown", "unknown"),
    limitations: [`Discovery failed: ${message}`],
  })
}

export async function mutateProviderExtension(
  input: ProviderExtensionMutation,
  options: { homeDir?: string } = {},
): Promise<ProviderExtensionMutationResult> {
  const home = path.resolve(options.homeDir ?? os.homedir())
  const candidateRoots = roots(home, input.cwd).filter(
    (entry) =>
      entry.provider === input.provider &&
      entry.kind === input.kind &&
      entry.source === input.source &&
      entry.capabilities[input.operation],
  )
  const targetRoot = candidateRoots[0]
  if (!targetRoot) {
    throw new Error(
      `${input.provider} ${input.kind} ${input.operation} is not supported for ${input.source} scope`,
    )
  }
  const name = normalizeName(input.name)
  if ((input.kind === "skill" || input.kind === "custom-agent") && !input.description.trim()) {
    throw new Error(`${input.kind} description is required by the provider format`)
  }
  const target =
    targetRoot.shape === "skill-directories"
      ? path.join(targetRoot.root, name, "SKILL.md")
      : path.join(targetRoot.root, `${name}.md`)
  const resolvedTarget = path.resolve(target)
  assertInsideRoot(resolvedTarget, targetRoot.root)
  if (input.operation !== "create") {
    if (!input.sourceId || path.resolve(input.sourceId) !== resolvedTarget) {
      throw new Error("Mutation identity does not match the provider-scoped target")
    }
  }

  if (input.operation === "delete") {
    await assertCanonicalInsideRoot(resolvedTarget, targetRoot.root)
    await atomicDelete(
      targetRoot.shape === "skill-directories" ? path.dirname(resolvedTarget) : resolvedTarget,
    )
  } else {
    let existingMetadata: Record<string, unknown> = {}
    if (input.operation === "create") {
      await fs.mkdir(path.dirname(resolvedTarget), { recursive: true, mode: 0o700 })
    } else {
      await assertCanonicalInsideRoot(resolvedTarget, targetRoot.root)
      await fs.access(resolvedTarget)
      existingMetadata = matter(await fs.readFile(resolvedTarget, "utf8")).data
    }
    if (input.operation === "create") {
      await assertCanonicalInsideRoot(resolvedTarget, targetRoot.root)
    }
    if (input.operation === "create") {
      try {
        await fs.access(resolvedTarget)
        throw new Error(`${input.provider} ${input.kind} "${name}" already exists in this scope`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    const serialized = serializeMarkdown(
      input.kind,
      name,
      input.description,
      input.content,
      existingMetadata,
    )
    await atomicWrite(resolvedTarget, serialized)
  }

  return {
    operation: input.operation,
    provider: input.provider,
    kind: input.kind,
    sourceId: resolvedTarget,
    id: providerExtensionId(input.provider, input.kind, resolvedTarget),
    runtimeReload: targetRoot.capabilities.runtime,
  }
}

function serializeMarkdown(
  kind: ProviderExtensionKind,
  name: string,
  description: string,
  content: string,
  existingMetadata: Record<string, unknown>,
): string {
  const metadata = {
    ...existingMetadata,
    ...(kind === "skill" || kind === "custom-agent" ? { name } : {}),
    description: description.trim(),
  }
  return matter.stringify(`${content.trim()}\n`, metadata)
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.flapstack-${process.pid}-${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" })
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function atomicDelete(file: string): Promise<void> {
  const staged = `${file}.flapstack-${process.pid}-${Date.now()}.delete`
  await fs.rename(file, staged)
  try {
    await fs.rm(staged, { recursive: true, force: true })
  } catch (error) {
    await fs.rename(staged, file).catch(() => undefined)
    throw error
  }
}

function normalizeName(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error("Extension name must use lowercase letters, numbers, and single hyphens")
  }
  return normalized
}

function safeName(value: string): boolean {
  return value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
}

function assertInsideRoot(file: string, rootPath: string): void {
  const relative = path.relative(path.resolve(rootPath), file)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Provider extension target escapes its configured root")
  }
}

async function assertCanonicalInsideRoot(file: string, rootPath: string): Promise<void> {
  const [canonicalRoot, canonicalParent] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(path.dirname(file)),
  ])
  const relative = path.relative(canonicalRoot, canonicalParent)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Provider extension target crosses a symbolic-link boundary")
  }
}

function displayPath(file: string, source: ProviderExtensionScope, rootPath: string): string {
  if (source === "project") return path.relative(path.dirname(path.dirname(rootPath)), file)
  const home = os.homedir()
  return file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file
}

export * from "./contract"
