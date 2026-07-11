import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "tailwindcss"
import autoprefixer from "autoprefixer"

const isDev = process.env.NODE_ENV !== "production"

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Don't externalize these - bundle them instead
        exclude: ["superjson", "trpc-electron", "gray-matter", "async-mutex"],
      }),
    ],
    build: {
      lib: {
        entry: {
          index: resolve(__dirname, "src/main/index.ts"),
          "mcp-control-stdio": resolve(__dirname, "src/main/mcp-control-stdio.ts"),
          "usage-daemon": resolve(__dirname, "src/main/usage-daemon.ts"),
        },
      },
      rollupOptions: {
        external: [
          "electron",
          "better-sqlite3",
          "@prisma/client",
          "@anthropic-ai/claude-agent-sdk", // ESM module - must use dynamic import
        ],
        output: {
          format: "cjs",
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["trpc-electron"],
      }),
    ],
    build: {
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    // One fixed port per checkout. Override with FLAPSTACK_DEV_PORT when another
    // Flapstack worktree is already running; never silently fall back.
    server: {
      port: Number(process.env.FLAPSTACK_DEV_PORT ?? 5173),
      strictPort: true,
    },
    plugins: [
      react({
        // In dev mode, use WDYR as JSX import source to track ALL component re-renders
        jsxImportSource: isDev ? "@welldone-software/why-did-you-render" : undefined,
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          login: resolve(__dirname, "src/renderer/login.html"),
        },
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss, autoprefixer],
      },
    },
  },
})
