import QRCode from "qrcode"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  mobileActionIds,
  type MobilePairingOffer,
  type MobileResourceRef,
} from "../../../../shared/mobile-control"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { RefreshCw } from "lucide-react"
import { RemoteComputerClientSection } from "./remote-computer-client"
import { mobileConnectionLink } from "../../../../shared/mobile-connection-link"

const resourceKinds = ["project", "task", "chat", "orchestration"] as const
type GrantResourceKind = (typeof resourceKinds)[number]

export function AgentsMobileCompanionTab() {
  const utils = trpc.useUtils()
  const status = trpc.mobileBridge.getStatus.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const interfaces = trpc.mobileBridge.listInterfaces.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const devices = trpc.mobileBridge.listDevices.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const grants = trpc.mobileBridge.listGrants.useQuery(
    {},
    {
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    },
  )
  const projects = trpc.projects.list.useQuery()
  const discoveryError = interfaces.error ?? devices.error ?? grants.error ?? projects.error
  const isRefreshingDiscovery =
    interfaces.isFetching || devices.isFetching || grants.isFetching || projects.isFetching
  const configure = trpc.mobileBridge.configure.useMutation()
  const createPairingOffer = trpc.mobileBridge.createPairingOffer.useMutation()
  const renameDevice = trpc.mobileBridge.renameDevice.useMutation()
  const revokeDevice = trpc.mobileBridge.revokeDevice.useMutation()
  const createGrant = trpc.mobileBridge.createGrant.useMutation()
  const revokeGrant = trpc.mobileBridge.revokeGrant.useMutation()
  const [bindAddress, setBindAddress] = useState("")
  const [offer, setOffer] = useState<MobilePairingOffer | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const offerGeneration = useRef(0)
  const [now, setNow] = useState(Date.now)
  const [qrError, setQrError] = useState(false)
  const [qrAttempt, setQrAttempt] = useState(0)
  const configuring = useRef(false)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [configurationNotice, setConfigurationNotice] = useState<string | null>(null)
  const [pairingNotice, setPairingNotice] = useState<string | null>(null)
  const bridge = !status.error && status.data?.state === "running" ? status.data : null
  const bridgeIdentity = bridge
    ? JSON.stringify([bridge.bindAddress, bridge.port, bridge.fingerprint])
    : null
  const [offerIdentity, setOfferIdentity] = useState<string | null>(null)
  const displayedOffer =
    bridgeIdentity && offerIdentity === bridgeIdentity && offer && offer.expiresAt > now
      ? offer
      : null
  useEffect(() => {
    if (!offer) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [offer])
  useEffect(() => {
    offerGeneration.current += 1
    setOffer(null)
    setQrDataUrl(null)
    return () => {
      offerGeneration.current += 1
    }
  }, [bridgeIdentity])
  const [names, setNames] = useState<Record<string, string>>({})
  const [grantDeviceId, setGrantDeviceId] = useState("")
  const [resourceKind, setResourceKind] = useState<GrantResourceKind>("project")
  const [resourceId, setResourceId] = useState("")
  const authorityReadUnavailable =
    devices.isLoading ||
    Boolean(devices.error) ||
    grants.isLoading ||
    Boolean(grants.error) ||
    (resourceKind === "project" && (projects.isLoading || Boolean(projects.error)))

  const activeDevices = useMemo(
    () => (devices.data ?? []).filter((device) => device.revokedAt === undefined),
    [devices.data],
  )

  useEffect(() => {
    if (!bindAddress)
      setBindAddress(status.data?.bindAddress ?? interfaces.data?.[0]?.address ?? "")
  }, [bindAddress, interfaces.data, status.data?.bindAddress])

  useEffect(() => {
    if (!activeDevices.some((device) => device.deviceId === grantDeviceId))
      setGrantDeviceId(activeDevices[0]?.deviceId ?? "")
  }, [activeDevices, grantDeviceId])

  useEffect(() => {
    if (!displayedOffer) {
      setQrDataUrl(null)
      return
    }
    let live = true
    setQrError(false)
    void QRCode.toDataURL(mobileConnectionLink(displayedOffer), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    })
      .then((value) => {
        if (live) setQrDataUrl(value)
      })
      .catch(() => {
        if (live) setQrError(true)
      })
    return () => {
      live = false
    }
  }, [displayedOffer, qrAttempt])

  const refresh = async () => {
    await Promise.all([
      utils.mobileBridge.getStatus.invalidate(),
      utils.mobileBridge.listInterfaces.invalidate(),
      utils.mobileBridge.listDevices.invalidate(),
      utils.mobileBridge.listGrants.invalidate(),
      utils.projects.list.invalidate(),
    ])
  }

  const setEnabled = async (enabled: boolean) => {
    if (configuring.current) return
    configuring.current = true
    setIsConfiguring(true)
    setConfigurationNotice(null)
    try {
      const result = await configure.mutateAsync({
        enabled,
        ...(enabled ? { bindAddress } : {}),
      })
      if (!enabled) {
        setOffer(null)
        setQrDataUrl(null)
      }
      setConfigurationNotice(
        result.state === "running"
          ? "Bridge is running."
          : result.state === "disabled"
            ? "Bridge is disabled."
            : `Bridge is ${result.state}. ${result.failure || "Refresh health before retrying."}`,
      )
      await refresh().catch(() => {
        setConfigurationNotice(
          "Bridge setting saved, but health could not be refreshed. Refresh bridge health before changing it again.",
        )
      })
    } catch (error) {
      setConfigurationNotice(
        error instanceof Error ? error.message : "Mobile bridge could not be changed.",
      )
    } finally {
      configuring.current = false
      setIsConfiguring(false)
    }
  }

  const createOffer = async () => {
    if (!bridgeIdentity) return
    const identity = bridgeIdentity
    const generation = ++offerGeneration.current
    setPairingNotice(null)
    setOffer(null)
    setQrDataUrl(null)
    try {
      const next = await createPairingOffer.mutateAsync()
      if (generation !== offerGeneration.current) return
      const endpoint = new URL(next.endpoint)
      const expected = JSON.parse(identity) as [string, number, string]
      if (
        endpoint.hostname.replace(/^\[|\]$/g, "") !== expected[0] ||
        Number(endpoint.port || 443) !== expected[1] ||
        next.certificateFingerprint !== expected[2]
      ) {
        setPairingNotice("The bridge changed. Refresh its status and create a fresh pairing QR.")
        return
      }
      setOfferIdentity(identity)
      setOffer(next)
    } catch (error) {
      if (generation === offerGeneration.current)
        setPairingNotice(
          error instanceof Error ? error.message : "Pairing offer could not be created.",
        )
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
          capabilities: mobileActionIds.filter(
            (action) => action !== "chat.create" || resourceKind === "project",
          ),
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

      {discoveryError && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive" role="alert">
            Mobile companion discovery unavailable: {discoveryError.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={isRefreshingDiscovery}
            onClick={() => void refresh()}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retry reads
          </Button>
        </div>
      )}

      <RemoteComputerClientSection />
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
            disabled={
              isConfiguring ||
              status.data?.state === "running" ||
              interfaces.isLoading ||
              interfaces.isFetching ||
              Boolean(interfaces.error)
            }
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
            <Button
              variant="outline"
              disabled={isConfiguring}
              onClick={() => void setEnabled(false)}
            >
              Disable bridge
            </Button>
          ) : (
            <Button
              disabled={
                isConfiguring ||
                !bindAddress ||
                Boolean(status.error) ||
                !status.data ||
                interfaces.isLoading ||
                interfaces.isFetching ||
                Boolean(interfaces.error)
              }
              onClick={() => void setEnabled(true)}
            >
              Enable bridge
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {status.error ? "Health unknown" : (status.data?.state ?? "Loading bridge health...")}
            {status.data?.bindAddress ? ` · ${status.data.bindAddress}:${status.data.port}` : ""}
          </span>
        </div>
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() =>
            void refresh().catch(() => toast.error("Bridge health could not be refreshed."))
          }
        >
          Refresh bridge health
        </Button>
        {configurationNotice && (
          <p role="status" className="text-sm">
            {configurationNotice}
          </p>
        )}
        {status.error && (
          <p role="alert" className="text-sm">
            Bridge health is unknown. Refresh to check the current state.
          </p>
        )}
        {!status.error && status.data?.failure && (
          <p role="alert" className="text-sm">
            Bridge stopped: {status.data.failure}. Check your private interface before enabling it
            again.
          </p>
        )}
      </section>

      <section className="space-y-3" data-settings-id="mobile-companion-pairing">
        <div>
          <h2 className="text-sm font-semibold">QR pairing</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The QR contains a short-lived single-use token. Confirm the exact certificate
            fingerprint on both screens.
          </p>
        </div>
        <Button
          disabled={!bridgeIdentity || isConfiguring || createPairingOffer.isPending}
          onClick={() => void createOffer()}
        >
          Create fresh pairing QR
        </Button>
        {offer && offer.expiresAt <= now && (
          <p role="status" className="text-sm">
            This pairing offer expired. Create a fresh pairing QR.
          </p>
        )}
        {pairingNotice && (
          <p role="status" className="text-sm">
            {pairingNotice}
          </p>
        )}
        {displayedOffer && (
          <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-[auto_1fr]">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                width={256}
                height={256}
                className="rounded-md bg-white p-2"
                alt="QR code for the current Flapstack mobile pairing offer"
              />
            ) : qrError ? (
              <div role="alert" className="space-y-2 text-sm">
                <p>QR could not be created. Retry it or copy the connection link.</p>
                <Button variant="outline" onClick={() => setQrAttempt((value) => value + 1)}>
                  Retry QR
                </Button>
              </div>
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
                  {displayedOffer.certificateFingerprint}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Expires</dt>
                <dd className="mt-1 text-muted-foreground">
                  {new Date(displayedOffer.expiresAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Endpoint</dt>
                <dd className="mt-1 font-mono text-muted-foreground">{displayedOffer.endpoint}</dd>
              </div>
              <div>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (displayedOffer.expiresAt <= Date.now()) {
                      setPairingNotice("This connection link expired. Create a fresh pairing QR.")
                      return
                    }
                    void navigator.clipboard.writeText(mobileConnectionLink(displayedOffer)).then(
                      () =>
                        setPairingNotice(
                          "Connection link copied. Paste it in Remote computer on the other computer.",
                        ),
                      () => setPairingNotice("Could not copy the connection link. Try again."),
                    )
                  }}
                >
                  Copy connection link
                </Button>
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
        {devices.error && !devices.data ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            Paired devices unavailable. Retry the discovery reads above before granting authority.
          </p>
        ) : (devices.data ?? []).length === 0 ? (
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
            disabled={authorityReadUnavailable}
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
            onChange={(event) => {
              setResourceKind(event.target.value as GrantResourceKind)
              setResourceId("")
            }}
            disabled={authorityReadUnavailable}
          >
            {resourceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          {resourceKind === "project" ? (
            <select
              aria-label="Project to allow"
              className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              disabled={authorityReadUnavailable}
            >
              <option value="">Choose a project</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Exact resource ID"
              placeholder="Exact resource ID"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              disabled={authorityReadUnavailable}
            />
          )}
        </div>
        <Button
          disabled={authorityReadUnavailable || !grantDeviceId || !resourceId.trim()}
          onClick={() => void grantControl()}
        >
          Allow chats and controls
        </Button>
        {grants.error && !grants.data && (
          <p role="alert" className="text-sm text-destructive">
            Authority grants unavailable. Retry the discovery reads above before changing access.
          </p>
        )}
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

function mobileSettingsError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
