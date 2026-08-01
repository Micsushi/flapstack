import { createHash, randomUUID } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import {
  agentPersonalityMetadataSchema,
  agentPersonalityTraitsSchema,
  agentPersonalityVersionRefSchema,
  type AgentPersonalityDocument,
  type AgentPersonalityMetadata,
  type AgentPersonalityVersionRef,
  type ResolvedAgentPersonalityDocument,
} from "../../../shared/agent-personalities"
import {
  parseAgentPersonalityMarkdown,
  serializeAgentPersonalityMarkdown,
} from "./personality-markdown"
import { assertProjectVaultContentSafe } from "../project-vaults/content-safety"

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    personalityId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    scope: agentPersonalityMetadataSchema.shape.scope,
    currentVersion: z.number().int().min(1),
    versionDigests: z.record(z.string().regex(/^[1-9]\d*$/), z.string().regex(/^[0-9a-f]{64}$/)),
    provenance: z
      .object({
        kind: z.enum(["local", "import"]),
        sourceLabel: z.string().trim().max(500).nullable(),
        trusted: z.boolean(),
      })
      .strict(),
    archivedAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

type Scope = AgentPersonalityMetadata["scope"]
type Manifest = z.infer<typeof manifestSchema>
type PersonalityInput = {
  name: string
  scope: Scope
  base: AgentPersonalityVersionRef | null
  traits: z.infer<typeof agentPersonalityTraitsSchema>
  body: string
}

const MAX_PERSONALITY_INHERITANCE_DEPTH = 32

export class AgentPersonalityStoreError extends Error {
  constructor(
    readonly code:
      "missing" | "archived" | "version-conflict" | "secret-detected" | "corrupt" | "unsafe-path",
    message: string,
  ) {
    super(message)
    this.name = "AgentPersonalityStoreError"
  }
}

export class AgentPersonalityStore {
  constructor(
    private readonly options: {
      userRoot: string
      projectRoot: (projectId: string) => string
      observeRoot?: (root: string) => void
    },
  ) {}

  rootFor(scope: Scope): string {
    const root =
      scope.type === "user" ? this.options.userRoot : this.options.projectRoot(scope.projectId)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const lexicalRoot = resolve(root)
    const info = lstatSync(lexicalRoot)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafePath("Personality storage root must be a real, non-symlink directory.")
    }
    const canonicalRoot = realpathSync.native(lexicalRoot)
    if (!samePath(lexicalRoot, canonicalRoot)) {
      throw unsafePath("Personality storage root cannot contain symlinked parents.")
    }
    this.options.observeRoot?.(lexicalRoot)
    return lexicalRoot
  }

  create(
    inputValue: PersonalityInput,
    provenance: Manifest["provenance"] = {
      kind: "local",
      sourceLabel: null,
      trusted: true,
    },
  ): AgentPersonalityDocument & { path: string } {
    const input = personalityInput(inputValue)
    if (input.base) this.resolveCombinedVisible(input.base, input.scope)
    const id = randomUUID()
    return this.createWithId(id, input, provenance)
  }

  createWithId(
    idValue: string,
    inputValue: PersonalityInput,
    provenance: Manifest["provenance"] = {
      kind: "local",
      sourceLabel: null,
      trusted: true,
    },
  ): AgentPersonalityDocument & { path: string } {
    const input = personalityInput(inputValue)
    if (input.base) this.resolveCombinedVisible(input.base, input.scope)
    const id = z.string().uuid().parse(idValue)
    const now = Date.now()
    const directory = this.personalityDirectory(input.scope, id)
    try {
      mkdirSync(directory, { recursive: false, mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const existing = this.get({ personalityId: id, version: 1 }, input.scope)
      const expected = documentFor(id, 1, input)
      const parsed = parseAgentPersonalityMarkdown(serializeAgentPersonalityMarkdown(expected))
      if (existing.digest !== parsed.digest) {
        throw new AgentPersonalityStoreError(
          "version-conflict",
          "Deterministic Personality identity is already bound to different content.",
        )
      }
      return { ...existing, path: join(directory, versionFilename(1)) }
    }
    const document = documentFor(id, 1, input)
    const path = join(directory, versionFilename(1))
    try {
      writeImmutable(path, serializeAgentPersonalityMarkdown(document))
      this.writeManifest(directory, {
        schemaVersion: 1,
        personalityId: id,
        name: input.name,
        scope: input.scope,
        currentVersion: 1,
        versionDigests: { "1": parseAgentPersonalityMarkdown(readFileSync(path, "utf8")).digest },
        provenance,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      return { ...this.get({ personalityId: id, version: 1 }, input.scope), path }
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
  }

  update(inputValue: {
    personalityId: string
    expectedVersion: number
    name?: string
    base?: AgentPersonalityVersionRef | null
    traits: z.infer<typeof agentPersonalityTraitsSchema>
    body: string
    scope?: Scope
  }): AgentPersonalityDocument & { path: string } {
    const id = z.string().uuid().parse(inputValue.personalityId)
    const located = this.locate(id, inputValue.scope)
    return this.withLock(located.directory, () => {
      const manifest = this.readManifest(located.directory)
      if (manifest.archivedAt !== null)
        throw new AgentPersonalityStoreError("archived", "Personality is archived.")
      if (manifest.currentVersion !== inputValue.expectedVersion) {
        throw new AgentPersonalityStoreError(
          "version-conflict",
          `Personality changed at version ${manifest.currentVersion}.`,
        )
      }
      const base =
        inputValue.base !== undefined
          ? inputValue.base
          : this.get({ personalityId: id, version: manifest.currentVersion }, manifest.scope)
              .metadata.base
      if (base) this.resolveCombinedVisible(base, manifest.scope)
      const nextVersion = manifest.currentVersion + 1
      const document = documentFor(id, nextVersion, {
        name: inputValue.name ?? manifest.name,
        scope: manifest.scope,
        base,
        traits: inputValue.traits,
        body: inputValue.body,
      })
      const path = join(located.directory, versionFilename(nextVersion))
      writeImmutable(path, serializeAgentPersonalityMarkdown(document))
      try {
        const parsed = parseAgentPersonalityMarkdown(readFileSync(path, "utf8"))
        this.writeManifest(located.directory, {
          ...manifest,
          name: document.metadata.name,
          currentVersion: nextVersion,
          versionDigests: {
            ...manifest.versionDigests,
            [String(nextVersion)]: parsed.digest,
          },
          updatedAt: Date.now(),
        })
        return { ...parsed, path }
      } catch (error) {
        rmSync(path, { force: true })
        throw error
      }
    })
  }

  get(refValue: AgentPersonalityVersionRef, scope?: Scope): AgentPersonalityDocument {
    const ref = agentPersonalityVersionRefSchema.parse(refValue)
    const located = this.locate(ref.personalityId, scope)
    const manifest = this.readManifest(located.directory)
    const expectedDigest = manifest.versionDigests[String(ref.version)]
    if (!expectedDigest)
      throw new AgentPersonalityStoreError("missing", "Personality version is missing.")
    const path = join(located.directory, versionFilename(ref.version))
    this.assertRegularFile(path)
    try {
      const parsed = parseAgentPersonalityMarkdown(readFileSync(path, "utf8"))
      assertProjectVaultContentSafe(readFileSync(path, "utf8"))
      if (
        parsed.digest !== expectedDigest ||
        parsed.metadata.id !== ref.personalityId ||
        parsed.metadata.version !== ref.version
      ) {
        throw new Error("Personality immutable version digest or identity changed.")
      }
      return parsed
    } catch (error) {
      this.quarantine(located.directory, path)
      throw new AgentPersonalityStoreError(
        "corrupt",
        `Personality version quarantined: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  resolve(ref: AgentPersonalityVersionRef, scope?: Scope): AgentPersonalityDocument {
    const located = this.locate(ref.personalityId, scope)
    const manifest = this.readManifest(located.directory)
    if (manifest.archivedAt !== null)
      throw new AgentPersonalityStoreError("archived", "Personality is archived.")
    return this.get(ref, manifest.scope)
  }

  resolveVisible(ref: AgentPersonalityVersionRef, profileScope: Scope): AgentPersonalityDocument {
    const scope = this.visibleScopeFor(ref.personalityId, profileScope)
    return this.resolve(ref, scope)
  }

  resolveCombinedVisible(
    refValue: AgentPersonalityVersionRef,
    profileScope: Scope,
  ): ResolvedAgentPersonalityDocument {
    const ref = agentPersonalityVersionRefSchema.parse(refValue)
    return this.resolveChain(ref, profileScope, [])
  }

  list(scope?: Scope): Manifest[] {
    const roots = scope ? [this.rootFor(scope)] : [this.rootFor({ type: "user", projectId: null })]
    return roots.flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .flatMap((entry) => {
          try {
            return [this.readManifest(join(root, entry.name))]
          } catch {
            return []
          }
        }),
    )
  }

  archive(input: { personalityId: string; expectedVersion: number; scope?: Scope }): Manifest {
    return this.setArchived(input, Date.now())
  }

  restore(input: { personalityId: string; expectedVersion: number; scope?: Scope }): Manifest {
    return this.setArchived(input, null)
  }

  private setArchived(
    input: { personalityId: string; expectedVersion: number; scope?: Scope },
    archivedAt: number | null,
  ): Manifest {
    const located = this.locate(z.string().uuid().parse(input.personalityId), input.scope)
    return this.withLock(located.directory, () => {
      const manifest = this.readManifest(located.directory)
      if (manifest.currentVersion !== input.expectedVersion) {
        throw new AgentPersonalityStoreError("version-conflict", "Personality version changed.")
      }
      const updated = { ...manifest, archivedAt, updatedAt: Date.now() }
      this.writeManifest(located.directory, updated)
      return updated
    })
  }

  private personalityDirectory(scope: Scope, id: string): string {
    return join(this.rootFor(scope), id)
  }

  private visibleScopeFor(personalityId: string, profileScope: Scope): Scope {
    const userScope = { type: "user", projectId: null } as const
    const userDirectory = this.personalityDirectory(userScope, personalityId)
    try {
      this.assertDirectory(userDirectory)
      return userScope
    } catch (error) {
      if (!(error instanceof AgentPersonalityStoreError) || error.code !== "missing") throw error
    }
    if (profileScope.type === "project") {
      const projectDirectory = this.personalityDirectory(profileScope, personalityId)
      this.assertDirectory(projectDirectory)
      return profileScope
    }
    throw new AgentPersonalityStoreError("missing", "Personality is missing.")
  }

  private resolveChain(
    ref: AgentPersonalityVersionRef,
    profileScope: Scope,
    stack: string[],
  ): ResolvedAgentPersonalityDocument {
    const identity = `${ref.personalityId}@${ref.version}`
    if (stack.includes(identity)) {
      throw new AgentPersonalityStoreError(
        "corrupt",
        `Personality inheritance cycle: ${[...stack, identity].join(" -> ")}.`,
      )
    }
    if (stack.length >= MAX_PERSONALITY_INHERITANCE_DEPTH) {
      throw new AgentPersonalityStoreError(
        "corrupt",
        `Personality inheritance exceeds ${MAX_PERSONALITY_INHERITANCE_DEPTH} versions.`,
      )
    }
    const scope = this.visibleScopeFor(ref.personalityId, profileScope)
    const document = this.resolve(ref, scope)
    if (!scopeCanInherit(document.metadata.scope, profileScope)) {
      throw new AgentPersonalityStoreError(
        "missing",
        "Base Personality scope is not visible from the selected profile.",
      )
    }
    if (!document.metadata.base) {
      return {
        ...document,
        chain: [{ ref, digest: document.digest }],
      }
    }
    const base = this.resolveChain(document.metadata.base, profileScope, [...stack, identity])
    const labels = [
      ...new Map(
        [...base.metadata.traits.labels, ...document.metadata.traits.labels].map((label) => [
          label.toLocaleLowerCase(),
          label,
        ]),
      ).values(),
    ]
    const body = [base.body.trim(), document.body.trim()].filter(Boolean).join("\n\n")
    const metadata = {
      ...document.metadata,
      traits: {
        ...base.metadata.traits,
        ...document.metadata.traits,
        labels,
      },
    }
    const chain = [...base.chain, { ref, digest: document.digest }]
    return {
      metadata,
      body,
      chain,
      digest: createHash("sha256")
        .update(JSON.stringify({ metadata, body, chain }), "utf8")
        .digest("hex"),
    }
  }

  private locate(id: string, scope?: Scope): { directory: string } {
    const candidates = scope
      ? [this.personalityDirectory(scope, id)]
      : [this.personalityDirectory({ type: "user", projectId: null }, id)]
    for (const directory of candidates) {
      try {
        this.assertDirectory(directory)
        return { directory }
      } catch (error) {
        if (error instanceof AgentPersonalityStoreError && error.code === "missing") continue
        throw error
      }
    }
    throw new AgentPersonalityStoreError("missing", "Personality is missing.")
  }

  private readManifest(directory: string): Manifest {
    const path = join(directory, "manifest.json")
    this.assertRegularFile(path)
    try {
      return manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")))
    } catch (error) {
      throw new AgentPersonalityStoreError(
        "corrupt",
        `Personality manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private writeManifest(directory: string, value: Manifest): void {
    const parsed = manifestSchema.parse(value)
    const path = join(directory, "manifest.json")
    const temporary = join(directory, `.manifest-${process.pid}-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  private withLock<T>(directory: string, action: () => T): T {
    const path = join(directory, ".write.lock")
    let descriptor: number
    try {
      descriptor = openSync(path, "wx", 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AgentPersonalityStoreError("version-conflict", "Personality is being edited.")
      }
      throw error
    }
    try {
      writeFileSync(descriptor, `${process.pid}:${process.ppid}`)
      return action()
    } finally {
      closeSync(descriptor)
      rmSync(path, { force: true })
    }
  }

  private quarantine(directory: string, path: string): void {
    const quarantine = join(dirname(directory), ".quarantine")
    mkdirSync(quarantine, { recursive: true, mode: 0o700 })
    try {
      renameSync(path, join(quarantine, `${basename(directory)}-${basename(path)}-${Date.now()}`))
    } catch {
      // The original remains unavailable because the read already failed closed.
    }
  }

  private assertDirectory(path: string): void {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw unsafePath("Personality directory cannot be a symlink.")
      if (!stat.isDirectory()) throw unsafePath("Personality path is not a directory.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AgentPersonalityStoreError("missing", "Personality is missing.")
      }
      throw error
    }
  }

  private assertRegularFile(path: string): void {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw unsafePath("Personality file cannot be a symlink.")
      if (!stat.isFile()) throw unsafePath("Personality path is not a regular file.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AgentPersonalityStoreError("missing", "Personality file is missing.")
      }
      throw error
    }
  }
}

function personalityInput(input: PersonalityInput): PersonalityInput {
  const scope = agentPersonalityMetadataSchema.shape.scope.parse(input.scope)
  const base = agentPersonalityVersionRefSchema.nullable().parse(input.base)
  const traits = agentPersonalityTraitsSchema.parse(input.traits)
  const name = z.string().trim().min(1).max(160).parse(input.name)
  const body = z.string().max(65_536).parse(input.body)
  const serialized = serializeAgentPersonalityMarkdown({
    metadata: {
      schemaVersion: 1,
      id: "validation",
      version: 1,
      name,
      scope,
      base,
      traits,
    },
    body,
  })
  try {
    assertProjectVaultContentSafe(serialized)
  } catch (error) {
    throw new AgentPersonalityStoreError(
      "secret-detected",
      error instanceof Error ? error.message : "Personality contains a secret.",
    )
  }
  return { name, scope, base, traits, body }
}

function documentFor(id: string, version: number, input: PersonalityInput) {
  return {
    metadata: {
      schemaVersion: 1 as const,
      id,
      version,
      name: input.name,
      scope: input.scope,
      base: input.base,
      traits: input.traits,
    },
    body: input.body,
  }
}

function writeImmutable(path: string, source: string): void {
  assertProjectVaultContentSafe(source)
  writeFileSync(path, source, { encoding: "utf8", flag: "wx", mode: 0o600 })
}

function versionFilename(version: number): string {
  return `v${version}.md`
}

function unsafePath(message: string): AgentPersonalityStoreError {
  return new AgentPersonalityStoreError("unsafe-path", message)
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right
}

function scopeCanInherit(scope: Scope, profileScope: Scope): boolean {
  return (
    scope.type === "user" ||
    (profileScope.type === "project" && scope.projectId === profileScope.projectId)
  )
}
