import { z } from "zod"

const idSchema = z.string().trim().min(1).max(200)
const pathSchema = z.string().trim().min(1).max(4_096)
const orderKeySchema = z.string().trim().min(1).max(512)
const timestampSchema = z.number().int().nonnegative()

export const SAVED_WORKSPACE_LAYOUT_VERSION = 1 as const
export const MAX_SAVED_WORKSPACE_LAYOUT_DEPTH = 32
export const MAX_SAVED_WORKSPACE_LAYOUT_NODES = 4_096
export const MAX_SAVED_WORKSPACE_LAYOUT_BYTES = 256 * 1_024

export const savedWorkspaceScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
  z.object({ type: z.literal("task"), taskId: idSchema }).strict(),
])

export const savedWorkspaceOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }).strict(),
  z.object({ kind: z.literal("orchestration"), orchestrationId: idSchema }).strict(),
])

const browserUrlSchema = z
  .string()
  .trim()
  .url()
  .max(8_192)
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  }, "Browser panes require an HTTP or HTTPS URL.")

export const savedWorkspacePaneBindingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), chatId: idSchema }).strict(),
  z
    .object({
      type: z.literal("terminal"),
      cwd: pathSchema,
      worktreePath: pathSchema.nullable(),
      restorePolicy: z.enum(["prompt", "never"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("diff"),
      worktreePath: pathSchema,
      baseRef: z.string().trim().min(1).max(512).nullable(),
      targetRef: z.string().trim().min(1).max(512).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("file"),
      path: pathSchema,
      worktreePath: pathSchema.nullable(),
      line: z.number().int().positive().nullable(),
    })
    .strict(),
  z.object({ type: z.literal("browser"), url: browserUrlSchema }).strict(),
  z.object({ type: z.literal("agent-roster"), orchestrationId: idSchema }).strict(),
  z
    .object({
      type: z.literal("selected-agent"),
      orchestrationId: idSchema,
      agentId: idSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal("activity"), orchestrationId: idSchema }).strict(),
])

export type SavedWorkspacePaneBinding = z.infer<typeof savedWorkspacePaneBindingSchema>

export const savedWorkspacePinnedContextSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: idSchema,
      type: z.literal("file"),
      path: pathSchema,
      worktreePath: pathSchema,
      line: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("chat-message"),
      chatId: idSchema,
      messageId: idSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal("browser"),
      url: browserUrlSchema,
    })
    .strict(),
])

export type SavedWorkspacePinnedContext = z.infer<typeof savedWorkspacePinnedContextSchema>

export type SavedWorkspaceLayoutNode =
  | {
      type: "split"
      id: string
      direction: "row" | "column"
      children: SavedWorkspaceLayoutNode[]
      sizes: number[]
    }
  | {
      type: "tabs"
      id: string
      activePaneId: string
      panes: Array<{
        id: string
        title?: string
        binding: SavedWorkspacePaneBinding
        pinnedContext?: SavedWorkspacePinnedContext[]
      }>
    }

const savedWorkspacePaneSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(200).optional(),
    binding: savedWorkspacePaneBindingSchema,
    pinnedContext: z.array(savedWorkspacePinnedContextSchema).max(64).optional(),
  })
  .strict()

const internalSavedWorkspaceLayoutNodeSchema: z.ZodType<SavedWorkspaceLayoutNode> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("split"),
        id: idSchema,
        direction: z.enum(["row", "column"]),
        children: z.array(internalSavedWorkspaceLayoutNodeSchema).min(2).max(16),
        sizes: z.array(z.number().finite().positive()).min(2).max(16),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.children.length !== value.sizes.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sizes"],
            message: "Split sizes must match the child count.",
          })
        }
      }),
    z
      .object({
        type: z.literal("tabs"),
        id: idSchema,
        activePaneId: idSchema,
        panes: z.array(savedWorkspacePaneSchema).min(1).max(128),
      })
      .strict()
      .superRefine((value, context) => {
        const paneIds = value.panes.map((pane) => pane.id)
        if (new Set(paneIds).size !== paneIds.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["panes"],
            message: "Pane IDs must be unique within a tab group.",
          })
        }
        if (!paneIds.includes(value.activePaneId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["activePaneId"],
            message: "The active pane must exist in its tab group.",
          })
        }
      }),
  ]),
)

const internalSavedWorkspaceLayoutSchema = z
  .object({
    version: z.literal(SAVED_WORKSPACE_LAYOUT_VERSION),
    root: internalSavedWorkspaceLayoutNodeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const identities = new Set<string>()
    const pending: SavedWorkspaceLayoutNode[] = [value.root]
    while (pending.length > 0) {
      const node = pending.pop()!
      if (identities.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["root"],
          message: `Layout node and pane IDs must be globally unique: ${node.id}.`,
        })
      }
      identities.add(node.id)
      if (node.type === "split") {
        pending.push(...node.children)
        continue
      }
      for (const pane of node.panes) {
        if (identities.has(pane.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["root"],
            message: `Layout node and pane IDs must be globally unique: ${pane.id}.`,
          })
        }
        identities.add(pane.id)
        for (const contextItem of pane.pinnedContext ?? []) {
          if (identities.has(contextItem.id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["root"],
              message: `Layout node, pane, and pinned-context IDs must be globally unique: ${contextItem.id}.`,
            })
          }
          identities.add(contextItem.id)
        }
      }
    }
  })

type LayoutComplexityResult =
  { success: true } | { success: false; path: Array<string | number>; message: string }

/**
 * Iterative guard that runs before the recursive layout schema. This prevents
 * hostile nesting or breadth from reaching Zod's recursive parser.
 */
function checkLayoutComplexity(value: unknown): LayoutComplexityResult {
  const pending: Array<{ value: unknown; depth: number; path: Array<string | number> }> = [
    { value, depth: 0, path: [] },
  ]
  const visited = new WeakSet<object>()
  let nodeCount = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.value === null || typeof current.value !== "object") continue
    if (current.depth > MAX_SAVED_WORKSPACE_LAYOUT_DEPTH) {
      return {
        success: false,
        path: current.path,
        message: `Saved workspace layout exceeds maximum depth ${MAX_SAVED_WORKSPACE_LAYOUT_DEPTH}.`,
      }
    }
    if (visited.has(current.value)) {
      return {
        success: false,
        path: current.path,
        message: "Saved workspace layout must not contain circular references.",
      }
    }
    visited.add(current.value)
    nodeCount += 1
    if (nodeCount > MAX_SAVED_WORKSPACE_LAYOUT_NODES) {
      return {
        success: false,
        path: current.path,
        message: `Saved workspace layout exceeds maximum node count ${MAX_SAVED_WORKSPACE_LAYOUT_NODES}.`,
      }
    }

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: [...current.path, index],
        })
      }
      continue
    }

    for (const [key, child] of Object.entries(current.value)) {
      pending.push({
        value: child,
        depth: current.depth + 1,
        path: [...current.path, key],
      })
    }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { success: false, path: [], message: "Saved workspace layout must be serializable." }
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVED_WORKSPACE_LAYOUT_BYTES) {
    return {
      success: false,
      path: [],
      message: `Saved workspace layout exceeds maximum serialized size ${MAX_SAVED_WORKSPACE_LAYOUT_BYTES} bytes.`,
    }
  }
  return { success: true }
}

const boundedSavedWorkspaceLayoutInputSchema = z.unknown().superRefine((value, context) => {
  const result = checkLayoutComplexity(value)
  if (!result.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: result.path,
      message: result.message,
    })
  }
})

export const savedWorkspaceLayoutSchema = boundedSavedWorkspaceLayoutInputSchema.pipe(
  internalSavedWorkspaceLayoutSchema,
)

export const savedWorkspaceLayoutJsonSchema = z
  .string()
  .superRefine((value, context) => {
    if (new TextEncoder().encode(value).byteLength > MAX_SAVED_WORKSPACE_LAYOUT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Saved workspace layout exceeds maximum serialized size ${MAX_SAVED_WORKSPACE_LAYOUT_BYTES} bytes.`,
      })
    }
  })
  .transform((value, context): unknown => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Saved workspace layout is invalid JSON.",
      })
      return z.NEVER
    }
  })
  .pipe(savedWorkspaceLayoutSchema)

export type SavedWorkspaceLayout = z.infer<typeof savedWorkspaceLayoutSchema>

export const savedWorkspaceRosterEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lead"),
      chatId: idSchema,
      agentId: z.null(),
      order: z.literal(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("agent"),
      chatId: idSchema,
      agentId: idSchema,
      order: z.number().int().positive().max(1_000_000),
    })
    .strict(),
])

export const savedWorkspaceRosterSchema = z
  .array(savedWorkspaceRosterEntrySchema)
  .max(1_001)
  .superRefine((entries, context) => {
    const chatIds = entries.map((entry) => entry.chatId)
    const agentIds = entries.filter((entry) => entry.kind === "agent").map((entry) => entry.agentId)
    const orders = entries.map((entry) => entry.order)
    if (new Set(chatIds).size !== chatIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Roster chat IDs must be unique." })
    }
    if (new Set(agentIds).size !== agentIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Roster agent IDs must be unique." })
    }
    if (new Set(orders).size !== orders.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Roster order values must be unique.",
      })
    }
  })

export const savedWorkspaceDtoSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(256),
    scope: savedWorkspaceScopeSchema,
    owner: savedWorkspaceOwnerSchema,
    layoutVersion: z.literal(SAVED_WORKSPACE_LAYOUT_VERSION),
    layout: savedWorkspaceLayoutSchema,
    roster: savedWorkspaceRosterSchema,
    sortOrder: orderKeySchema,
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    archivedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.layout.version !== value.layoutVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layoutVersion"],
        message: "Layout version metadata must match the pane tree version.",
      })
    }
    if (value.owner.kind === "manual" && value.roster.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roster"],
        message: "Manual workspaces do not own an orchestration roster.",
      })
    }
    if (value.owner.kind === "orchestration") {
      if (value.scope.type !== "task") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["owner", "orchestrationId"],
          message: "Orchestration workspaces must be task scoped.",
        })
      }
      if (value.roster.filter((entry) => entry.kind === "lead").length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roster"],
          message: "Orchestration workspaces require exactly one lead roster entry.",
        })
      }
    }
  })

export type SavedWorkspaceScope = z.infer<typeof savedWorkspaceScopeSchema>
export type SavedWorkspaceOwner = z.infer<typeof savedWorkspaceOwnerSchema>
export type SavedWorkspaceRosterEntry = z.infer<typeof savedWorkspaceRosterEntrySchema>
export type SavedWorkspaceDto = z.infer<typeof savedWorkspaceDtoSchema>

export type SavedWorkspaceOperationAgent = {
  agentId: string
  chatId: string | null
  chatName: string | null
  chatState: "pending" | "ready" | "archived"
  runId: string | null
  parentAgentId: string | null
  replacedAgentId: string | null
  role: string
  name: string
  harness: string | null
  status: string
  progressPercent: number
  resultSummary: string | null
  stopReason: string | null
  blockerCount: number
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
}

export type SavedWorkspaceOperationProjection = {
  workspaceId: string
  orchestrationId: string
  taskId: string
  taskName: string
  projectId: string
  initiatingChatId: string
  initiatingChatName: string | null
  status: string
  roster: SavedWorkspaceRosterEntry[]
  agents: SavedWorkspaceOperationAgent[]
  materializedAgentCount: number
  pendingAgentCount: number
  overflowChatCount: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}
