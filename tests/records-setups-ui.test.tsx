// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it, vi } from "vitest"
import { mountSetups } from "@project-records/setups.js"

const recordsRoot = resolve(
  process.cwd(),
  process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE || "../project-records",
)

it("ships the canonical saved Setup editor through the shared Records mount", () => {
  const board = readFileSync(resolve(recordsRoot, "ui/shared/board.js"), "utf8")
  const editor = readFileSync(resolve(recordsRoot, "ui/shared/setups.js"), "utf8")
  const template = readFileSync(resolve(recordsRoot, "ui/shared/template.js"), "utf8")
  expect(board).toContain('from "./setups.js"')
  expect(template).toContain('id="open-setups"')
  expect(editor).toContain("export function mountSetups")
  expect(editor).toContain("/v1/setups")
  expect(editor).toContain("/v1/setup/preview")
  expect(editor).toContain('"aria-label": "Editable Setup graph"')
  expect(editor).toContain("setup-add-node")
  expect(editor).toContain("setup-add-edge")
  expect(editor).toContain("setup-import-preview")
  expect(editor).toContain("setup-duplicate")
  expect(editor).toContain("setup-assign")
  expect(template).toContain('id="setups-root"')
  expect(template).toContain(".setup-graph")
})

it("retains graph edits and project selection on refresh and can replace a removed connection", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const definition = {
    schemaVersion: 1,
    nodes: [
      { id: "worker", label: "Worker", type: "role", settings: {} },
      { id: "queue", label: "Queue", type: "queue", settings: {} },
    ],
    edges: [
      { id: "edge-1", from: "worker", to: "queue", kind: "routes" },
      { id: "edge-2", from: "queue", to: "worker", kind: "requires" },
    ],
    layout: {},
  }
  const setup = {
    id: "setup-one",
    name: "Saved setup",
    versions: [{ version: 1, digest: "digest-one", definition }],
  }
  const request = vi.fn(async (_path: string, options?: { body?: string }) => ({
    revision: options ? "r2" : "r1",
    setups: [setup],
    assignments: [],
    setupId: setup.id,
    version: 1,
  }))
  const controller = mountSetups(host, {
    request,
    getProjects: () => [
      { id: "one", name: "One" },
      { id: "two", name: "Two" },
    ],
  })
  const element = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!
  try {
    await controller.load()
    const project = element<HTMLSelectElement>("setup-project")
    expect(project.tagName).toBe("SELECT")
    project.value = "two"
    project.dispatchEvent(new Event("change", { bubbles: true }))
    host.querySelector<HTMLButtonElement>('[data-node-id="worker"]')!.click()
    expect(document.activeElement?.getAttribute("data-node-id")).toBe("worker")
    element<HTMLInputElement>("setup-inspect-label").value = "Edited worker"
    element<HTMLInputElement>("setup-inspect-label").dispatchEvent(
      new Event("input", { bubbles: true }),
    )
    await controller.load()
    expect(element("setup-node-list").textContent).toContain("Edited worker")
    expect(project.value).toBe("two")
    host.querySelector<HTMLButtonElement>('button[data-edge-id="edge-1"]')!.click()
    element<HTMLButtonElement>("setup-remove-edge").click()
    element<HTMLSelectElement>("setup-edge-from").value = "worker"
    element<HTMLSelectElement>("setup-edge-to").value = "queue"
    element<HTMLSelectElement>("setup-edge-kind").value = "routes"
    element<HTMLButtonElement>("setup-add-edge").click()
    element<HTMLButtonElement>("setup-save").click()
    await vi.waitFor(() =>
      expect(request.mock.calls.some(([, options]) => options?.body)).toBe(true),
    )
    const body = JSON.parse(request.mock.calls.find(([, options]) => options?.body)![1]!.body!)
    expect(body.definition.nodes[0].label).toBe("Edited worker")
    const ids = body.definition.edges.map((edge: { id: string }) => edge.id)
    expect(new Set(ids).size).toBe(ids.length)
  } finally {
    host.remove()
  }
})
