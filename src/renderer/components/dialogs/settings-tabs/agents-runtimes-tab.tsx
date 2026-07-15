import { useMemo, useState } from "react"
import type { RuntimeDefaultScope } from "../../../../shared/agent-runtime"
import { Button } from "../../ui/button"
import { trpc } from "../../../lib/trpc"
import {
  buildRuntimeSettingsRows,
  runtimePreferenceLabel,
} from "../../../features/agents/runtime-settings"

export function AgentsRuntimesTab() {
  const utils = trpc.useUtils()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: defaults = [], isLoading, error } = trpc.agentRuntimeDefaults.list.useQuery()
  const { data: releases = [] } = trpc.agentRuntimeDefaults.capabilities.useQuery()
  const [projectId, setProjectId] = useState<string>("")
  const [announcement, setAnnouncement] = useState("")
  const scope: RuntimeDefaultScope = projectId
    ? { type: "project", id: projectId }
    : { type: "global", id: null }
  const rows = useMemo(
    () => buildRuntimeSettingsRows({ scope, defaults, releases }),
    [defaults, releases, scope.type, projectId],
  )
  const write = trpc.agentRuntimeDefaults.write.useMutation({
    async onSuccess(value) {
      await utils.agentRuntimeDefaults.list.invalidate()
      setAnnouncement(`${value.harness} Runtime default saved.`)
    },
    onError(value) {
      setAnnouncement(`${value.message} Reloaded current Runtime defaults.`)
      void utils.agentRuntimeDefaults.list.invalidate()
    },
  })
  const remove = trpc.agentRuntimeDefaults.delete.useMutation({
    async onSuccess() {
      await utils.agentRuntimeDefaults.list.invalidate()
      setAnnouncement("Project Runtime override reset.")
    },
    onError(value) {
      setAnnouncement(`${value.message} Reloaded current Runtime defaults.`)
      void utils.agentRuntimeDefaults.list.invalidate()
    },
  })

  return (
    <section className="space-y-6 p-6" aria-labelledby="runtime-settings-heading">
      <div data-settings-id="runtime-settings-table" tabIndex={-1}>
        <h1 id="runtime-settings-heading" className="text-lg font-semibold">
          Agent Runtimes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Runtime controls how one harness starts, resumes, and reports activity. It does not change
          the model, permissions, worktree, or coordination engine.
        </p>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Scope</span>
        <select
          aria-label="Runtime settings scope"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="block h-9 w-full rounded-md border border-input bg-background px-3"
        >
          <option value="">Global defaults</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              Project: {project.name}
            </option>
          ))}
        </select>
      </label>

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading Runtime defaults…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Runtime defaults could not load: {error.message}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Runtime defaults by agent harness</caption>
            <thead className="bg-muted/40 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Harness
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Runtime
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = row.options.find((option) => option.value === row.selected)
                return (
                  <tr key={row.harness} className="border-t align-top">
                    <th scope="row" className="px-3 py-3 text-left font-medium">
                      {row.label}
                    </th>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`${row.label} Runtime`}
                        value={row.selected}
                        disabled={write.isPending || remove.isPending}
                        onChange={(event) => {
                          const preference = event.target.value as typeof row.selected
                          write.mutate({
                            scope,
                            harness: row.harness,
                            preference,
                            expectedVersion: row.version,
                          })
                        }}
                        className="h-8 rounded-md border border-input bg-background px-2"
                      >
                        {row.options.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={
                              !option.compatible ||
                              (!option.available && option.value !== row.selected)
                            }
                          >
                            {option.label}
                            {!option.compatible
                              ? " — incompatible"
                              : !option.available
                                ? " — unavailable"
                                : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="max-w-xs px-3 py-3 text-xs text-muted-foreground">
                      {projectId && row.version === 0
                        ? `Inherited ${runtimePreferenceLabel(row.inherited ?? "auto")}`
                        : `Version ${row.version || "new"}`}
                      {selected?.reason ? (
                        <span className="mt-1 block">{selected.reason}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {projectId && row.version > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            remove.mutate({
                              scope,
                              harness: row.harness,
                              expectedVersion: row.version,
                            })
                          }
                        >
                          Reset
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div data-settings-id="runtime-diagnostics" tabIndex={-1} className="rounded-lg border p-4">
        <h2 className="font-medium">Launch diagnostics</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {releases.map((release) => (
            <li key={release.runtime}>
              {runtimePreferenceLabel(release.runtime)}:{" "}
              {release.enabledForNewLaunches ? "available" : release.reason}
            </li>
          ))}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
