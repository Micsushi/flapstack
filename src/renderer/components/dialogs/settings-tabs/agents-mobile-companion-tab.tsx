import QRCode from "qrcode"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { MobilePairingOffer, MobileResourceRef } from "../../../../shared/mobile-control"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"

const resourceKinds = ["project", "task", "chat", "orchestration"] as const
type GrantResourceKind = (typeof resourceKinds)[number]

export function AgentsMobileCompanionTab() {
  const utils = trpc.useUtils()
  const status = trpc.mobileBridge.getStatus.useQuery()
  const interfaces = trpc.mobileBridge.listInterfaces.useQuery()
  const devices = trpc.mobileBridge.listDevices.useQuery()
  const grants = trpc.mobileBridge.listGrants.useQuery({})
  const configure = trpc.mobileBridge.configure.useMutation()
  const createPairingOffer = trpc.mobileBridge.createPairingOffer.useMutation()
  const renameDevice = trpc.mobileBridge.renameDevice.useMutation()
  const revokeDevice = trpc.mobileBridge.revokeDevice.useMutation()
  const createGrant = trpc.mobileBridge.createGrant.useMutation()
  const revokeGrant = trpc.mobileBridge.revokeGrant.useMutation()
  const [bindAddress, setBindAddress] = useState("")
  const [offer, setOffer] = useState<MobilePairingOffer | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [grantDeviceId, setGrantDeviceId] = useState("")
  const [resourceKind, setResourceKind] = useState<GrantResourceKind>("project")
  const [resourceId, setResourceId] = useState("")

  const activeDevices = useMemo(
    () => (devices.data ?? []).filter((device) => device.revokedAt === undefined),
    [devices.data],
  )

  useEffect(() => {
    if (status.data?.bindAddress) setBindAddress(status.data.bindAddress)
    else if (!bindAddress && interfaces.data?.[0]) setBindAddress(interfaces.data[0].address)
  }, [bindAddress, interfaces.data, status.data?.bindAddress])

  useEffect(() => {
    if (!grantDeviceId && activeDevices[0]) setGrantDeviceId(activeDevices[0].deviceId)
  }, [activeDevices, grantDeviceId])

  useEffect(() => {
    if (!offer) {
      setQrDataUrl(null)
      return
    }
    let live = true
    void QRCode.toDataURL(pairingLaunchUrl(offer), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    }).then((value) => {
      if (live) setQrDataUrl(value)
    })
    return () => {
      live = false
    }
  }, [offer])

  const refresh = async () => {
    await Promise.all([
      utils.mobileBridge.getStatus.invalidate(),
      utils.mobileBridge.listInterfaces.invalidate(),
      utils.mobileBridge.listDevices.invalidate(),
      utils.mobileBridge.listGrants.invalidate(),
    ])
  }

  const setEnabled = async (enabled: boolean) => {
    try {
      await configure.mutateAsync({
        enabled,
        ...(enabled ? { bindAddress } : {}),
      })
      if (!enabled) {
        setOffer(null)
        setQrDataUrl(null)
      }
      await refresh()
      toast.success(
        enabled ? "Mobile companion bridge enabled" : "Mobile companion bridge disabled",
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mobile bridge could not be changed.")
    }
  }

  const createOffer = async () => {
    try {
      const next = await createPairingOffer.mutateAsync()
      setOffer(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pairing offer could not be created.")
    }
  }

  const saveName = async (deviceId: string, currentName: string) => {
    try {
      const name = names[deviceId]?.trim() || currentName
      await renameDevice.mutateAsync({ deviceId, name })
      await utils.mobileBridge.listDevices.invalidate()
      toast.success("Paired device renamed")
    } catch (error) {
      toast.error(mobileSettingsError(error, "Paired device could not be renamed."))
    }
  }

  const revoke = async (deviceId: string, name: string) => {
    if (!window.confirm(`Revoke ${name}? Its active sessions will close immediately.`)) return
    try {
      await revokeDevice.mutateAsync({ deviceId, reason: "user" })
      await refresh()
      toast.success("Paired device revoked")
    } catch (error) {
      toast.error(mobileSettingsError(error, "Paired device could not be revoked."))
    }
  }

  const grantControl = async () => {
    if (!grantDeviceId || !resourceId.trim()) return
    try {
      const resource: MobileResourceRef = { kind: resourceKind, id: resourceId.trim() }
      await createGrant.mutateAsync({
        deviceId: grantDeviceId,
        grant: {
          authority: ["respond", "control", "approve"],
          capabilities: [
            "clarification.answer",
            "orchestration.pause",
            "orchestration.resume",
            "orchestration.cancel",
            "approval.approve",
            "approval.deny",
          ],
          resources: [resource],
        },
      })
      await refresh()
      toast.success("Mobile authority granted")
    } catch (error) {
      toast.error(mobileSettingsError(error, "Mobile authority could not be granted."))
    }
  }

  const copyGrantId = async (grantId: string) => {
    try {
      await navigator.clipboard.writeText(grantId)
      toast.success("Grant ID copied")
    } catch (error) {
      toast.error(mobileSettingsError(error, "Grant ID could not be copied."))
    }
  }

  const revokeAuthorityGrant = async (grantId: string) => {
    try {
      await revokeGrant.mutateAsync({ grantId })
      await refresh()
      toast.success("Mobile authority revoked")
    } catch (error) {
      toast.error(mobileSettingsError(error, "Mobile authority could not be revoked."))
    }
  }

  return (
    <div className="space-y-7 p-6">
      <header>
        <h1 className="text-lg font-semibold">Mobile Companion</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Pair a browser on your private network to monitor and control only explicitly granted
          Flapstack work. The bridge stays off until you enable it.
        </p>
      </header>

      <section className="space-y-3" data-settings-id="mobile-companion-bridge">
        <div>
          <h2 className="text-sm font-semibold">Private HTTPS bridge</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Public, wildcard, loopback, and inactive addresses are rejected. An unsafe network
            change stops the bridge.
          </p>
        </div>
        <label className="block text-xs font-medium">
          Private interface
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={bindAddress}
            onChange={(event) => setBindAddress(event.target.value)}
            disabled={status.data?.state === "running"}
          >
            {(interfaces.data ?? []).map((entry) => (
              <option key={`${entry.name}:${entry.address}`} value={entry.address}>
                {entry.name} · {entry.address}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {status.data?.state === "running" ? (
            <Button variant="outline" onClick={() => void setEnabled(false)}>
              Disable bridge
            </Button>
          ) : (
            <Button disabled={!bindAddress} onClick={() => void setEnabled(true)}>
              Enable bridge
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {status.data?.state ?? "loading"}
            {status.data?.bindAddress ? ` · ${status.data.bindAddress}:${status.data.port}` : ""}
          </span>
        </div>
      </section>

      <section className="space-y-3" data-settings-id="mobile-companion-pairing">
        <div>
          <h2 className="text-sm font-semibold">QR pairing</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The QR contains a short-lived single-use token. Confirm the exact certificate
            fingerprint on both screens.
          </p>
        </div>
        <Button disabled={status.data?.state !== "running"} onClick={() => void createOffer()}>
          Create fresh pairing QR
        </Button>
        {offer && (
          <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-[auto_1fr]">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                width={256}
                height={256}
                className="rounded-md bg-white p-2"
                alt="QR code for the current Flapstack mobile pairing offer"
              />
            ) : (
              <div
                className="h-64 w-64 animate-pulse rounded-md bg-muted"
                aria-label="Creating QR"
              />
            )}
            <dl className="space-y-2 break-all text-xs">
              <div>
                <dt className="font-medium">Certificate fingerprint</dt>
                <dd className="mt-1 font-mono text-muted-foreground">
                  {offer.certificateFingerprint}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Expires</dt>
                <dd className="mt-1 text-muted-foreground">
                  {new Date(offer.expiresAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Endpoint</dt>
                <dd className="mt-1 font-mono text-muted-foreground">{offer.endpoint}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      <section className="space-y-3" data-settings-id="mobile-companion-devices">
        <div>
          <h2 className="text-sm font-semibold">Paired devices</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Renaming changes only the local label. Revocation closes active sessions immediately.
          </p>
        </div>
        {(devices.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No devices paired.
          </p>
        ) : (
          (devices.data ?? []).map((device) => (
            <div key={device.deviceId} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="h-9 min-w-48 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label={`Name for ${device.name}`}
                  value={names[device.deviceId] ?? device.name}
                  disabled={device.revokedAt !== undefined}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [device.deviceId]: event.target.value }))
                  }
                />
                <Button
                  variant="outline"
                  disabled={device.revokedAt !== undefined}
                  onClick={() => void saveName(device.deviceId, device.name)}
                >
                  Rename
                </Button>
                <Button
                  variant="destructive"
                  disabled={device.revokedAt !== undefined}
                  onClick={() => void revoke(device.deviceId, device.name)}
                >
                  Revoke
                </Button>
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {device.deviceId} · scope {device.scopeVersion}
                {device.revokedAt
                  ? ` · revoked ${new Date(device.revokedAt).toLocaleString()}`
                  : ""}
              </p>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3" data-settings-id="mobile-companion-authority">
        <div>
          <h2 className="text-sm font-semibold">Authority grants</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Grant one exact project, task, Chat, or orchestration. Privileged approval and cancel
            requests still require strong verification or a desktop decision.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            aria-label="Paired device"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={grantDeviceId}
            onChange={(event) => setGrantDeviceId(event.target.value)}
          >
            {activeDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Resource kind"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={resourceKind}
            onChange={(event) => setResourceKind(event.target.value as GrantResourceKind)}
          >
            {resourceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Exact resource ID"
            placeholder="Exact resource ID"
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
          />
        </div>
        <Button disabled={!grantDeviceId || !resourceId.trim()} onClick={() => void grantControl()}>
          Grant bounded mobile control
        </Button>
        {(grants.data ?? []).map((grant) => (
          <div key={grant.grantId} className="rounded-xl border border-border p-4 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong>
                  {activeDevices.find((device) => device.deviceId === grant.deviceId)?.name ??
                    grant.deviceId}
                </strong>
                <p className="mt-1 font-mono text-muted-foreground">{grant.grantId}</p>
                <p className="mt-1 text-muted-foreground">
                  {grant.resources.map((resource) => `${resource.kind}:${resource.id}`).join(", ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void copyGrantId(grant.grantId)}>
                  Copy grant ID
                </Button>
                <Button
                  variant="destructive"
                  disabled={revokeGrant.isPending}
                  onClick={() => void revokeAuthorityGrant(grant.grantId)}
                >
                  Revoke grant
                </Button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs leading-5 text-muted-foreground">
        Remote access requires your own VPN or tunnel. Flapstack does not provide a hosted relay,
        guaranteed background push, or a native mobile client.
      </p>
    </div>
  )
}

function pairingLaunchUrl(offer: MobilePairingOffer): string {
  const payload = new TextEncoder().encode(JSON.stringify(offer))
  let binary = ""
  for (const byte of payload) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
  return `${offer.endpoint}/?pair=${encoded}`
}

function mobileSettingsError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
