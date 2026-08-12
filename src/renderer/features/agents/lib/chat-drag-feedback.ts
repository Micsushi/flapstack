export function configureChatDragFeedback(dataTransfer: DataTransfer, label: string): void {
  dataTransfer.effectAllowed = "copyMove"
  dataTransfer.setData("text/plain", label)

  const dragImage = document.createElement("div")
  dragImage.textContent = `+  ${label}`
  Object.assign(dragImage.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    maxWidth: "240px",
    overflow: "hidden",
    padding: "6px 10px",
    border: "1px solid rgba(125, 211, 252, 0.8)",
    borderRadius: "6px",
    background: "rgba(17, 24, 39, 0.96)",
    color: "white",
    font: "12px system-ui, sans-serif",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  })
  document.body.appendChild(dragImage)
  dataTransfer.setDragImage(dragImage, 12, 12)
  setTimeout(() => dragImage.remove(), 0)
}

export function shouldPopOutChatDrag(
  session: { screenX: number; screenY: number; cancelled: boolean },
  end: { dropEffect: DataTransfer["dropEffect"]; screenX: number; screenY: number },
): boolean {
  if (session.cancelled || end.dropEffect !== "none") return false
  if (end.screenX === 0 && end.screenY === 0) return false
  return Math.hypot(end.screenX - session.screenX, end.screenY - session.screenY) >= 12
}
