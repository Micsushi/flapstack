// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { AgentsMobileCompanionTab } from "../src/renderer/components/dialogs/settings-tabs/agents-mobile-companion-tab"
const mock = vi.hoisted(() => ({
  status: { data: null as any, error: null as any, isFetching: false },
  qr: vi.fn(),
  query: vi.fn(),
  invalidate: vi.fn(),
  create: vi.fn(),
  mutation: vi.fn(),
  deviceQuery: vi.fn(),
  grantQuery: vi.fn(),
  devices: [{ deviceId: "d", name: "Phone", pairedAt: 0 }],
}))
vi.mock("qrcode", () => ({
  default: { toDataURL: mock.qr },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../src/renderer/components/dialogs/settings-tabs/remote-computer-client", () => ({
  RemoteComputerClientSection: () => null,
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    projects: { list: { useQuery: () => ({ data: [{ id: "project-1", name: "Flapstack" }] }) } },
    useUtils: () => ({
      mobileBridge: Object.fromEntries(
        ["getStatus", "listInterfaces", "listDevices", "listGrants"].map((key) => [
          key,
          { invalidate: mock.invalidate },
        ]),
      ),
    }),
    mobileBridge: {
      getStatus: {
        useQuery: (input: unknown, options: unknown) => {
          mock.query(input, options)
          return mock.status
        },
      },
      listInterfaces: {
        useQuery: () => ({
          data: [
            { name: "Private", address: "192.168.1.2" },
            { name: "Other", address: "192.168.1.3" },
          ],
        }),
      },
      listDevices: {
        useQuery: (input: unknown, options: unknown) => {
          mock.deviceQuery(input, options)
          return { data: mock.devices }
        },
      },
      listGrants: {
        useQuery: (input: unknown, options: unknown) => {
          mock.grantQuery(input, options)
          return { data: [] }
        },
      },
      createPairingOffer: { useMutation: () => ({ mutateAsync: mock.create, isPending: false }) },
      ...Object.fromEntries(
        ["configure", "renameDevice", "revokeDevice", "createGrant", "revokeGrant"].map((key) => [
          key,
          { useMutation: () => ({ mutateAsync: mock.mutation, isPending: false }) },
        ]),
      ),
    },
  },
}))
let root: Root, container: HTMLDivElement
const running = {
  state: "running",
  enabled: true,
  bindAddress: "192.168.1.2",
  port: 4317,
  fingerprint: "sha256:" + "a".repeat(64),
  failure: null,
}
const offerCreatedAt = Date.now()
const offer = {
  protocolVersion: 1,
  endpoint: "https://192.168.1.2:4317",
  certificateFingerprint: "sha256:" + "a".repeat(64),
  oneTimeToken: "a".repeat(43),
  createdAt: offerCreatedAt,
  expiresAt: offerCreatedAt + 120_000,
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mock.status = { data: { ...running }, error: null, isFetching: false }
  mock.qr.mockReset().mockResolvedValue("data:image/png;base64,cXJmaXh0dXJl")
  mock.create.mockReset()
  mock.mutation.mockReset()
  mock.invalidate.mockReset()
  mock.query.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () => root.render(<AgentsMobileCompanionTab />))
}
async function click(name: string) {
  const b = [...container.querySelectorAll("button")].find((b) => b.textContent === name)!
  expect(b).toBeTruthy()
  await act(async () => b.click())
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
it("observes stopped health, hides stale QR and preserves name/resource drafts without mutations", async () => {
  mock.create.mockResolvedValue(offer)
  await render()
  await click("Create fresh pairing QR")
  expect(container.querySelector("img")).not.toBeNull()
  const name = container.querySelector('[aria-label="Name for Phone"]') as HTMLInputElement
  const resource = container.querySelector('[aria-label="Project to allow"]') as HTMLSelectElement
  await fill(name, "Draft name")
  await act(async () => {
    resource.value = "project-1"
    resource.dispatchEvent(new Event("change", { bubbles: true }))
  })
  mock.status.data = {
    ...running,
    state: "faulted",
    enabled: false,
    fingerprint: null,
    failure: "network-changed",
  }
  await render()
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("Bridge stopped: network-changed")
  expect(name.value).toBe("Draft name")
  expect(resource.value).toBe("project-1")
  expect(mock.mutation).not.toHaveBeenCalled()
  await click("Refresh bridge health")
  expect(mock.invalidate).toHaveBeenCalled()
  expect(mock.query).toHaveBeenLastCalledWith(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
})
it("rejects a late pairing response after observed stop, including stop then same identity restart", async () => {
  let resolve!: (value: unknown) => void
  mock.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  await render()
  await click("Create fresh pairing QR")
  mock.status.data = { ...running, state: "disabled" }
  await render()
  mock.status.data = { ...running }
  await render()
  await act(async () => resolve(offer))
  expect(container.querySelector("img")).toBeNull()
  expect(mock.mutation).not.toHaveBeenCalled()
})
it("invalidates on health error or certificate change and never presents unknown as disabled", async () => {
  mock.create.mockResolvedValue(offer)
  await render()
  await click("Create fresh pairing QR")
  mock.status.error = new Error("Unavailable")
  await render()
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("Health unknown")
  expect(
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Create fresh pairing QR",
    )?.disabled,
  ).toBe(true)
  mock.status.error = null
  mock.status.data = { ...running, fingerprint: "sha256:changed" }
  await render()
  await click("Create fresh pairing QR")
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("The bridge changed")
})

it("clears the previous QR while encoding an immediately returned replacement", async () => {
  mock.create.mockResolvedValue(offer)
  await render()
  await click("Create fresh pairing QR")
  expect(container.querySelector("img")).not.toBeNull()
  let finish!: (value: string) => void
  mock.qr.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  mock.create.mockResolvedValue({ ...offer, oneTimeToken: "b".repeat(43) })
  await click("Create fresh pairing QR")
  expect(container.querySelector("img")).toBeNull()
  await act(async () => finish("data:image/png;base64,bmV3"))
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,bmV3")
})

it("refreshes paired phones and access while the settings panel is visible", async () => {
  await render()
  expect(mock.deviceQuery).toHaveBeenCalledWith(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  expect(mock.grantQuery).toHaveBeenCalledWith(
    {},
    {
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    },
  )
})

it("grants the selected named project without requiring an internal ID", async () => {
  await render()
  const project = container.querySelector<HTMLSelectElement>('[aria-label="Project to allow"]')!
  expect(project.textContent).toContain("Flapstack")
  expect(container.querySelector('[aria-label="Exact resource ID"]')).toBeNull()
  await act(async () => {
    project.value = "project-1"
    project.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await click("Allow chats and controls")
  expect(mock.mutation).toHaveBeenCalledWith(
    expect.objectContaining({
      deviceId: "d",
      grant: expect.objectContaining({ resources: [{ kind: "project", id: "project-1" }] }),
    }),
  )
})
