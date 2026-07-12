import { toast } from "sonner"

/**
 * Provider error toast with a Copy Error action, matching the Claude
 * transport's error toast so every provider surfaces failures the same way.
 */
export function showProviderErrorToast(
  title: string,
  description: string | undefined,
  context?: Record<string, unknown>,
) {
  const message = description || "An unexpected error occurred"
  const errorDetails = [
    `Error: ${message}`,
    `Timestamp: ${new Date().toISOString()}`,
    context ? `Context: ${JSON.stringify(context, null, 2)}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  toast.error(title, {
    description: message.length > 300 ? message.slice(0, 300) + "..." : message,
    duration: 12000,
    action: {
      label: "Copy Error",
      onClick: () => {
        navigator.clipboard.writeText(errorDetails)
        toast.success("Error details copied to clipboard")
      },
    },
  })
}
