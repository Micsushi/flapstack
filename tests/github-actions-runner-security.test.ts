import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "..")
const require = createRequire(import.meta.url)
const { load } = require("js-yaml") as { load: (source: string) => unknown }
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8")
const providerDrift = readFileSync(resolve(root, ".github/workflows/provider-drift.yml"), "utf8")

type WorkflowJob = {
  if?: string
  "runs-on"?: string | string[]
  steps?: Array<{ uses?: string }>
}

type Workflow = {
  on?: string | string[] | Record<string, unknown>
  permissions?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

const workflowDirectory = resolve(root, ".github/workflows")
const workflows = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({
    name,
    workflow: load(readFileSync(resolve(workflowDirectory, name), "utf8")) as Workflow,
  }))

function handlesPullRequests(workflow: Workflow): boolean {
  if (typeof workflow.on === "string") return workflow.on === "pull_request"
  if (Array.isArray(workflow.on)) return workflow.on.includes("pull_request")
  return workflow.on !== undefined && "pull_request" in workflow.on
}

function isSelfHosted(job: WorkflowJob): boolean {
  const labels = Array.isArray(job["runs-on"]) ? job["runs-on"] : [job["runs-on"]]
  return labels.includes("self-hosted")
}

function allowsOnlyTrustedEvents(condition: string | undefined): boolean {
  if (!condition) return false
  const compact = condition.replaceAll(/\s|\(|\)/g, "")
  if (compact.includes("pull_request")) return false
  if (compact.includes("workflow_dispatch")) {
    return compact.includes("github.ref=='refs/heads/main'")
  }
  return (
    compact.includes("github.event_name=='push'") ||
    compact.includes("github.event_name=='schedule'")
  )
}

describe("GitHub Actions self-hosted runner policy", () => {
  it("keeps pull-request CI on GitHub-hosted Linux", () => {
    expect(ci).toMatch(
      /verify:\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s+runs-on: \[self-hosted, Linux, X64, server1, flapstack\]/,
    )
    expect(ci).toMatch(
      /verify-pr:\s+if: github\.event_name == 'pull_request'\s+runs-on: ubuntu-latest/,
    )
  })

  it("keeps pull-request provider checks off Server1", () => {
    expect(providerDrift).toMatch(
      /codex-catalog:\s+if: github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\)\s+runs-on: \[self-hosted, Linux, X64, server1, flapstack\]/,
    )
    expect(providerDrift).toMatch(
      /codex-catalog-pr:\s+if: github\.event_name == 'pull_request'\s+runs-on: ubuntu-latest/,
    )
  })

  it("excludes pull requests from every self-hosted workflow job", () => {
    const unsafeJobs = workflows.flatMap(({ name, workflow }) => {
      if (!handlesPullRequests(workflow)) return []
      return Object.entries(workflow.jobs ?? {})
        .filter(([, job]) => isSelfHosted(job) && !allowsOnlyTrustedEvents(job.if))
        .map(([jobName]) => `${name}:${jobName}`)
    })

    expect(unsafeJobs).toEqual([])
  })

  it("retains the trusted Server1 label and explicit read-only permissions", () => {
    expect(ci).toContain("runs-on: [self-hosted, Linux, X64, server1, flapstack]")
    expect(providerDrift).toContain("runs-on: [self-hosted, Linux, X64, server1, flapstack]")
    for (const workflowName of ["ci.yml", "provider-drift.yml"]) {
      const workflow = workflows.find(({ name }) => name === workflowName)?.workflow
      expect(workflow?.permissions, workflowName).toEqual({ contents: "read" })
    }
  })

  it("pins every external action used by a self-hosted job to a full commit SHA", () => {
    const unpinnedActions = workflows.flatMap(({ name, workflow }) =>
      Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) => {
        if (!isSelfHosted(job)) return []
        return (job.steps ?? [])
          .map((step) => step.uses)
          .filter(
            (uses): uses is string =>
              uses !== undefined &&
              !uses.startsWith("./") &&
              !uses.startsWith("docker://") &&
              !/@[0-9a-f]{40}$/.test(uses),
          )
          .map((uses) => `${name}:${jobName}:${uses}`)
      }),
    )

    expect(unpinnedActions).toEqual([])
  })
})
