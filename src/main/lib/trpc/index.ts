import { initTRPC, TRPCError } from "@trpc/server"
import { BrowserWindow } from "electron"
import superjson from "superjson"
import { acquireConfiguredAppDatabaseOperation } from "../db/access"
import { betaFeatureForTrpcPath, isBetaFeatureEnabled } from "../beta-features/settings"
import type { BetaFeatureId } from "../../../shared/beta-features"

/**
 * Context passed to all tRPC procedures
 */
export interface Context {
  getWindow: () => BrowserWindow | null
}

/**
 * Initialize tRPC with context and superjson transformer
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    }
  },
})

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router
export const middleware = t.middleware
export const databaseMaintenanceProcedure = t.procedure

const databaseOperationMiddleware = middleware(async ({ path, next }) => {
  const betaFeature = betaFeatureForTrpcPath(path)
  if (betaFeature && !isBetaFeatureEnabled(betaFeature)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Enable ${betaFeature} in Settings > Beta Features to use this feature.`,
    })
  }
  const release = acquireConfiguredAppDatabaseOperation()
  try {
    return await next()
  } finally {
    release()
  }
})

export const publicProcedure = t.procedure.use(databaseOperationMiddleware)

export const betaProcedure = (feature: BetaFeatureId) =>
  publicProcedure.use(async ({ next }) => {
    if (!isBetaFeatureEnabled(feature)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Enable ${feature} in Settings > Beta Features to use this feature.`,
      })
    }
    return next()
  })

/**
 * Middleware to log procedure calls
 */
export const loggerMiddleware = middleware(async ({ path, type, next }) => {
  const start = Date.now()
  const result = await next()
  const duration = Date.now() - start
  console.log(`[tRPC] ${type} ${path} - ${duration}ms`)
  return result
})

/**
 * Procedure with logging
 */
export const loggedProcedure = publicProcedure.use(loggerMiddleware)
