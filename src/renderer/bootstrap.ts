const storedTheme = localStorage.getItem("theme")
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
const theme =
  storedTheme === "light"
    ? "light"
    : storedTheme === "dark"
      ? "dark"
      : prefersDark
        ? "dark"
        : "light"

document.documentElement.classList.add(theme)

window.addEventListener("error", (event) => {
  console.error("[Renderer] Unhandled error:", event.error ?? event.message)

  const root = document.getElementById("root")
  if (!root || root.childElementCount > 0) return

  const message = document.createElement("p")
  message.setAttribute("role", "alert")
  message.style.padding = "20px"
  message.style.color = "hsl(var(--destructive))"
  message.textContent = "Flapstack could not start. Open diagnostics or restart the app."
  root.replaceChildren(message)
})
