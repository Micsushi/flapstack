import { z } from "zod"
import { usageRollupQuerySchema } from "./advanced-usage"

const idSchema = z.string().trim().min(1).max(200)

export const usageExplorerMetrics = ["cost-usd-micros", "total-tokens", "request-count"] as const
export const usageExplorerMetricSchema = z.enum(usageExplorerMetrics)

export const usageExplorerViewSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    query: usageRollupQuerySchema,
    metric: usageExplorerMetricSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

export const saveUsageExplorerViewSchema = z
  .object({
    id: idSchema.nullable().optional(),
    name: z.string().trim().min(1).max(100),
    query: usageRollupQuerySchema,
    metric: usageExplorerMetricSchema.default("cost-usd-micros"),
  })
  .strict()

export const usageExplorerExportSchema = z
  .object({
    query: usageRollupQuerySchema,
    format: z.enum(["csv", "json"]),
    includeRedactedRawPayload: z.boolean().default(false),
  })
  .strict()

export type UsageExplorerMetric = z.infer<typeof usageExplorerMetricSchema>
export type UsageExplorerView = z.infer<typeof usageExplorerViewSchema>
export type SaveUsageExplorerView = z.infer<typeof saveUsageExplorerViewSchema>
export type UsageExplorerExportInput = z.infer<typeof usageExplorerExportSchema>
