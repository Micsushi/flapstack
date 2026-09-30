import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query"
import { createTRPCProxyClient } from "@trpc/client"
import { ipcLink } from "trpc-electron/renderer"
import type { AppRouter } from "../../main/lib/trpc/routers"
import superjson from "superjson"

/**
 * React hooks for tRPC
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>()

/**
 * One IPC client for React and imperative callers in this renderer. Separate
 * clients reuse request IDs on the shared reply channel and cross-wire results.
 */
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink({ transformer: superjson })],
})
