// Why Did You Render - MUST be first import (before React)
import "./wdyr"

// Only initialize Sentry when a DSN is configured; local packaged test builds
// should not load Sentry's optional runtime modules at startup.
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  import("@sentry/electron/renderer")
    .then((Sentry) => {
      Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN })
    })
    .catch((error) => {
      console.warn("[App] Failed to initialize renderer Sentry:", error)
    })
}

import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./styles/globals.css"
import { preloadDiffHighlighter } from "./lib/themes/diff-view-highlighter"

// Preload shiki highlighter for diff view (prevents delay when opening diff sidebar)
preloadDiffHighlighter()

// Suppress ResizeObserver loop error - this is a non-fatal browser warning
// that can occur when layout changes trigger observation callbacks
// Common with virtualization libraries and diff viewers
const resizeObserverErr = /ResizeObserver loop/

// Handle both error event and unhandledrejection
window.addEventListener("error", (e) => {
  if (e.message && resizeObserverErr.test(e.message)) {
    e.stopImmediatePropagation()
    e.preventDefault()
    return false
  }
})

// Also override window.onerror for broader coverage
const originalOnError = window.onerror
window.onerror = (message, source, lineno, colno, error) => {
  if (typeof message === "string" && resizeObserverErr.test(message)) {
    return true // Suppress the error
  }
  if (originalOnError) {
    return originalOnError(message, source, lineno, colno, error)
  }
  return false
}

const rootElement = document.getElementById("root")

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />)
}
