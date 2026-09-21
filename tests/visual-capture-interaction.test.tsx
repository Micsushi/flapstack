// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => {
  const png = "data:image/png;base64,b3duZWQ="
  const calls = {
    beginUser: vi.fn().mockResolvedValue({ id: "request" }),
    selectSource: vi.fn().mockResolvedValue({}),
    captureSelected: vi.fn().mockResolvedValue({ resultId: "result" }),
    previewEdit: vi.fn().mockResolvedValue({
      previewDataUrl: png,
      previewSha256: "preview-hash",
      width: 10,
      height: 10,
    }),
    confirm: vi.fn().mockResolvedValue({
      record: { id: "artifact", derivativeSha256: "confirmed-hash" },
      dataUrl: png,
    }),
    cancelPreview: vi.fn().mockResolvedValue({}),
    cancelRequest: vi.fn().mockResolvedValue({}),
  }
  const empty = { data: [], refetch: vi.fn() }
  const sources = {
    data: [{ id: "source", kind: "window", label: "Owned synthetic window", displayId: null }],
  }
  const procedures: Record<string, unknown> = {}
  for (const name of [
    "beginUser",
    "beginApprovedAgent",
    "selectSource",
    "captureSelected",
    "cancelRequest",
    "cancelPreview",
    "previewEdit",
    "confirm",
    "selectForChat",
    "archive",
    "setRetention",
    "delete",
    "exportSelected",
    "importDerivative",
    "cleanupExpired",
  ]) {
    const mutation = { mutateAsync: calls[name as keyof typeof calls] ?? vi.fn(), isPending: false }
    procedures[name] = { useMutation: () => mutation }
  }
  for (const name of ["approvedAgentRequests", "history", "auditHistory"])
    procedures[name] = { useQuery: () => empty }
  procedures.listSources = { useQuery: () => sources }
  return { calls, procedures }
})
vi.mock("../src/renderer/lib/trpc", () => ({ trpc: { visualCapture: fixture.procedures } }))
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))
import { VisualCaptureDialog } from "../src/renderer/features/agents/ui/visual-capture-dialog"

it.each(["confirm", "cancel"])(
  "keeps the redacted derivative private until explicit confirmation (%s)",
  async (decision) => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const attach = vi.fn()
    const close = vi.fn()
    const click = async (label: string) => {
      const button = [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
      )
      expect(button, label).toBeDefined()
      await act(async () => button!.click())
    }
    try {
      await act(async () =>
        root.render(
          <VisualCaptureDialog
            open
            onOpenChange={close}
            projectId="project"
            chatId="chat"
            taskId="task"
            onAddAttachments={attach}
          />,
        ),
      )
      expect(fixture.calls.beginUser).toHaveBeenCalledWith({
        scope: { projectId: "project", chatId: "chat", taskId: "task" },
      })
      await click("Capture window: Owned synthetic window")
      expect(attach).not.toHaveBeenCalled()
      const checkbox = [...document.querySelectorAll("label")]
        .find((item) => item.textContent?.includes("Enable solid redaction"))!
        .querySelector("input")!
      await act(async () => checkbox.click())
      const blocked = [...document.querySelectorAll("button")].find((item) =>
        item.textContent?.includes("Preview changes before confirming"),
      )!
      expect(blocked.disabled).toBe(true)
      expect(fixture.calls.confirm).not.toHaveBeenCalled()
      await click("Preview changes")
      expect(attach).not.toHaveBeenCalled()
      if (decision === "cancel") {
        await click("Cancel")
        expect(fixture.calls.cancelPreview).toHaveBeenCalledWith({ resultId: "result" })
        expect(fixture.calls.confirm).not.toHaveBeenCalled()
        expect(attach).not.toHaveBeenCalled()
        expect(close).toHaveBeenCalledWith(false)
        return
      }
      await click("Confirm and add")
      expect(fixture.calls.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          resultId: "result",
          expectedPreviewSha256: "preview-hash",
          edit: expect.objectContaining({
            redactions: [{ left: 0, top: 0, width: 10, height: 10, color: "#111111" }],
          }),
        }),
      )
      expect(attach).toHaveBeenCalledTimes(1)
      expect(attach.mock.calls[0]![0][0]).toMatchObject({
        name: "flapstack-visual-artifact-confirmed-hash.png",
        type: "image/png",
      })
      expect(close).toHaveBeenCalledWith(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    }
  },
)
