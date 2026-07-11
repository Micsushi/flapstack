export function operationStatusLabel(operation: {
  kind: string
  state: string
  progressMessage: string | null
  errorMessage: string | null
}) {
  if (operation.errorMessage) return `${operation.kind}: ${operation.errorMessage}`
  if (operation.progressMessage) return `${operation.kind}: ${operation.progressMessage}`
  return `${operation.kind}: ${operation.state}`
}

export function flapshotCaptureControlsEnabled(connected: boolean, paired: boolean | null) {
  return connected && paired === true
}

export function flapshotStatusLabel(input: {
  connected: boolean
  paired: boolean | null
  pairingCode: string | null
  serverVersion: string | null
  error: string | null
  latest?: Parameters<typeof operationStatusLabel>[0]
}) {
  if (!input.connected) return input.error ?? "Flapshot disconnected"
  if (input.paired === false) {
    return input.pairingCode
      ? `Pair code ${input.pairingCode} in Flapshot Agent access`
      : "Flapshot pairing status unavailable"
  }
  if (input.latest) return operationStatusLabel(input.latest)
  if (input.paired === null) {
    return `Flapshot ${input.serverVersion ?? "connected"} · pair pending MCP access in Flapshot if prompted`
  }
  return `Flapshot ${input.serverVersion ?? "paired"} · paired`
}

export function flapshotActionErrorMessage(message: string | undefined, fallback: string) {
  if (message?.includes("APPROVAL_REQUIRED")) {
    return "Approve this request in Flapshot, then retry without reconnecting"
  }
  if (message?.includes("CLIENT_UNPAIRED")) {
    return "Pair this live connection in Flapshot Agent access"
  }
  return message || fallback
}
