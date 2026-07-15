import type { inferRouterOutputs } from "@trpc/server"
import { useEffect, useMemo, useState } from "react"
import { ArchiveRestore, Download, GitBranch, Loader2, ShieldCheck, Upload } from "lucide-react"
import type { AppRouter } from "../../../../main/lib/trpc/routers"
import type { PortableScopeId } from "../../../../shared/portability"
import {
  clampPortabilityPage,
  importApplyConfirmation,
  paginatePortabilityResults,
  parseTargetRootMappings,
  PORTABILITY_RESULT_PAGE_SIZE,
  privateSyncConfirmation,
  unresolvedPortabilityConflicts,
} from "../../../features/settings/portability-ui-state"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"

type Outputs = inferRouterOutputs<AppRouter>
type ImportPlan = Outputs["importExport"]["dryRunImport"]
type SyncPreview = Outputs["importExport"]["previewPrivateSync"]
type Resolution = "keep-local" | "use-incoming" | "keep-both"

export function AgentsPortabilityTab() {
  const capabilities = trpc.importExport.getCapabilities.useQuery()
  const projects = trpc.importExport.listProjects.useQuery()
  const privateSync = trpc.importExport.getPrivateSync.useQuery()
  const utils = trpc.useUtils()
  const [selectedScopes, setSelectedScopes] = useState<PortableScopeId[]>(["settings", "projects"])
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [outputPath, setOutputPath] = useState("")
  const [bundlePath, setBundlePath] = useState("")
  const [importExtensionsRoot, setImportExtensionsRoot] = useState("")
  const [importProjectRoots, setImportProjectRoots] = useState("")
  const [importVaultRoots, setImportVaultRoots] = useState("")
  const [activeExportId, setActiveExportId] = useState<string | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [page, setPage] = useState(0)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [lastBackup, setLastBackup] = useState<{ operationId: string; backupPath: string } | null>(
    null,
  )
  const [syncRepo, setSyncRepo] = useState("")
  const [syncRemote, setSyncRemote] = useState("")
  const [syncBranch, setSyncBranch] = useState("main")
  const [syncScopes, setSyncScopes] = useState<PortableScopeId[]>(["settings"])
  const [commitMessage, setCommitMessage] = useState("Update Flapstack private sync")
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null)
  const [syncPage, setSyncPage] = useState(0)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  const createExport = trpc.importExport.createExport.useMutation()
  const chooseExportPath = trpc.importExport.chooseExportPath.useMutation()
  const chooseDirectory = trpc.importExport.chooseDirectory.useMutation()
  const cancelExport = trpc.importExport.cancelExport.useMutation()
  const dryRun = trpc.importExport.dryRunImport.useMutation()
  const prepareImportConfirmation = trpc.importExport.prepareImportConfirmation.useMutation()
  const applyImport = trpc.importExport.applyImport.useMutation()
  const restoreBackup = trpc.importExport.restoreBackup.useMutation()
  const recover = trpc.importExport.recoverInterrupted.useMutation()
  const linkSync = trpc.importExport.linkPrivateSync.useMutation()
  const pullSync = trpc.importExport.pullPrivateSync.useMutation()
  const commitSync = trpc.importExport.commitPrivateSync.useMutation()
  const pushSync = trpc.importExport.pushPrivateSync.useMutation()
  const unlinkSync = trpc.importExport.unlinkPrivateSync.useMutation()

  const changes = useMemo(
    () =>
      plan
        ? [
            ...plan.database.map((entry) => ({ ...entry, source: "database" as const })),
            ...plan.files.map((entry) => ({ ...entry, source: "file" as const })),
          ]
        : [],
    [plan],
  )
  const pageSize = PORTABILITY_RESULT_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(changes.length / pageSize))
  const visibleChanges = paginatePortabilityResults(changes, page, pageSize)
  const syncPageCount = Math.max(
    1,
    Math.ceil((syncPreview?.files.length ?? 0) / PORTABILITY_RESULT_PAGE_SIZE),
  )
  const visibleSyncFiles = paginatePortabilityResults(
    syncPreview?.files ?? [],
    syncPage,
    PORTABILITY_RESULT_PAGE_SIZE,
  )
  const unresolved = unresolvedPortabilityConflicts(changes, resolutions)
  const busy =
    createExport.isPending ||
    dryRun.isPending ||
    applyImport.isPending ||
    linkSync.isPending ||
    pullSync.isPending ||
    commitSync.isPending ||
    pushSync.isPending

  useEffect(() => {
    setSyncPage((current) =>
      clampPortabilityPage(current, syncPreview?.files.length ?? 0, PORTABILITY_RESULT_PAGE_SIZE),
    )
  }, [syncPreview])

  const run = async (label: string, action: () => Promise<void>) => {
    setError("")
    setStatus(label)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStatus("")
    }
  }

  const invalidateImportPlan = () => {
    setPlan(null)
    setResolutions({})
    setPage(0)
  }

  return (
    <div className="space-y-8 px-6 py-6" data-settings-id="portability-export-import">
      <header>
        <h1 className="text-lg font-semibold">Portability &amp; private sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Secrets stay out. Imports always dry-run. Git actions require an exact preview.
        </p>
      </header>

      <section
        className="space-y-4 rounded-lg border border-border p-4"
        aria-labelledby="portable-export-title"
      >
        <div>
          <h2 id="portable-export-title" className="font-medium">
            Export a portable bundle
          </h2>
          <p className="text-xs text-muted-foreground">
            Creates a versioned .flapstack-export directory with checksums and an exclusion report.
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Scopes</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(capabilities.data?.scopes ?? []).map((scope) => (
              <label
                key={scope.id}
                className="flex items-start gap-2 rounded border border-border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.id)}
                  onChange={() => setSelectedScopes(toggle(selectedScopes, scope.id))}
                />
                <span>
                  <span className="block font-medium">{scope.label}</span>
                  <span className="text-xs text-muted-foreground">{scope.sensitivity}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Projects (optional filter)</legend>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border p-2">
            {(projects.data ?? []).map((project) => (
              <label key={project.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedProjects.includes(project.id)}
                  onChange={() => setSelectedProjects(toggle(selectedProjects, project.id))}
                />
                <span className="truncate">{project.name}</span>
              </label>
            ))}
            {projects.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">No projects registered.</p>
            )}
          </div>
        </fieldset>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <LabeledInput
              label="Output directory"
              value={outputPath}
              onChange={setOutputPath}
              placeholder="/path/backup.flapstack-export"
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              void chooseExportPath.mutateAsync().then((path) => path && setOutputPath(path))
            }
          >
            Browse…
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={busy || !outputPath || selectedScopes.length === 0}
            onClick={() => {
              const operationId = crypto.randomUUID()
              setActiveExportId(operationId)
              void run("Exporting selected scopes…", async () => {
                const result = await createExport.mutateAsync({
                  operationId,
                  outputPath,
                  scopes: selectedScopes.map((id) => ({
                    id,
                    ...(capabilities.data?.scopes.find((scope) => scope.id === id)
                      ?.projectFilter === "optional" && selectedProjects.length > 0
                      ? { projectIds: selectedProjects }
                      : {}),
                  })),
                })
                setStatus(
                  `Export complete: ${result.fileCount} files, ${result.databaseRecords} database records, ${result.exclusions.length} exclusions.`,
                )
                setActiveExportId(null)
              })
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          {createExport.isPending && activeExportId && (
            <Button
              variant="outline"
              onClick={() => void cancelExport.mutateAsync({ operationId: activeExportId })}
            >
              Cancel
            </Button>
          )}
        </div>
      </section>

      <section
        className="space-y-4 rounded-lg border border-border p-4"
        aria-labelledby="portable-import-title"
      >
        <div>
          <h2 id="portable-import-title" className="font-medium">
            Dry-run import
          </h2>
          <p className="text-xs text-muted-foreground">
            Verification, migration, and diff happen before any live write.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <LabeledInput
              label="Bundle directory"
              value={bundlePath}
              onChange={(value) => {
                setBundlePath(value)
                invalidateImportPlan()
              }}
              placeholder="/path/backup.flapstack-export"
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              void chooseDirectory.mutateAsync({ title: "Choose portable bundle" }).then((path) => {
                if (path) {
                  setBundlePath(path)
                  invalidateImportPlan()
                }
              })
            }
          >
            Browse…
          </Button>
        </div>
        <Button
          variant="outline"
          disabled={busy || !bundlePath}
          onClick={() =>
            void run("Verifying and staging import…", async () => {
              const next = await dryRun.mutateAsync({
                bundlePath,
                targetRoots: {
                  ...(importExtensionsRoot ? { extensions: importExtensionsRoot } : {}),
                  projects: parseTargetRootMappings(importProjectRoots),
                  projectVaults: parseTargetRootMappings(importVaultRoots),
                },
              })
              setPlan(next)
              setResolutions({})
              setPage(0)
              setStatus(
                next.mappingRequirements.length > 0
                  ? `Dry-run ready without writes. ${next.mappingRequirements.length} portable target mapping${next.mappingRequirements.length === 1 ? " is" : "s are"} required before apply.`
                  : `Dry-run ready: ${next.summary.create} create, ${next.summary.update} update, ${next.summary.conflict} conflict, ${next.summary.skip} skip.`,
              )
            })
          }
        >
          <Upload className="mr-2 h-4 w-4" />
          Run dry-run
        </Button>

        <fieldset className="space-y-2 rounded border border-border p-3">
          <legend className="text-sm font-medium">Reviewed target mappings</legend>
          <p className="text-xs text-muted-foreground">
            Source-machine paths are metadata only and are never accessed or reused. Missing
            extension and vault roots are created only after confirmed apply under their verified
            parent.
          </p>
          <LabeledInput
            label="Extensions target root"
            value={importExtensionsRoot}
            onChange={(value) => {
              setImportExtensionsRoot(value)
              invalidateImportPlan()
            }}
            placeholder="/Users/name/.agents"
          />
          <LabeledInput
            label="Project roots"
            value={importProjectRoots}
            onChange={(value) => {
              setImportProjectRoots(value)
              invalidateImportPlan()
            }}
            placeholder="project-id=/absolute/project/path"
          />
          <LabeledInput
            label="Project vault roots"
            value={importVaultRoots}
            onChange={(value) => {
              setImportVaultRoots(value)
              invalidateImportPlan()
            }}
            placeholder="project-id=/absolute/vault/path"
          />
        </fieldset>

        {plan && (
          <div className="space-y-3" aria-label="Import dry-run results">
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {(["create", "update", "conflict", "skip"] as const).map((kind) => (
                <div key={kind} className="rounded border border-border p-2">
                  <span className="block text-lg font-semibold">{plan.summary[kind]}</span>
                  {kind}
                </div>
              ))}
            </div>
            <div className="rounded border border-border p-2 text-xs">
              <span className="font-medium">Reviewed live targets: </span>
              <span className="break-all font-mono">{JSON.stringify(plan.targetRoots)}</span>
            </div>
            {plan.mappingRequirements.length > 0 && (
              <div
                role="status"
                aria-live="polite"
                className="space-y-1 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-xs"
              >
                <p className="font-medium">Portable target remapping required</p>
                <p>
                  No files or database values were changed. Enter each destination below, then run
                  dry-run again to bind apply to the reviewed mapping.
                </p>
                <ul className="list-disc pl-5">
                  {plan.mappingRequirements.map((requirement) => (
                    <li key={`${requirement.kind}:${requirement.projectId}`}>
                      {requirement.kind === "project-vault" ? "Project vault" : "Project"}{" "}
                      <span className="font-mono">{requirement.projectId}</span>: add to{" "}
                      <span className="font-mono">{requirement.targetRootField}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.exclusions.length > 0 && (
              <p className="rounded bg-muted p-2 text-xs">
                {plan.exclusions.length} secret or unsupported items excluded. Reports show
                categories and paths only.
              </p>
            )}
            <div className="max-h-80 overflow-auto rounded border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    <th className="p-2">Decision</th>
                    <th className="p-2">Scope</th>
                    <th className="p-2">Item</th>
                    <th className="p-2">Reviewed values</th>
                    <th className="p-2">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleChanges.map((entry) => (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="p-2 font-medium">{entry.kind}</td>
                      <td className="p-2">{entry.scopeId}</td>
                      <td className="max-w-64 truncate p-2">
                        {entry.source === "database"
                          ? `${entry.tableName} ${JSON.stringify(entry.identity)}`
                          : `${entry.bundlePath} → ${entry.targetPath ?? "unmapped"}`}
                      </td>
                      <td className="max-w-80 space-y-1 p-2 font-mono text-[10px]">
                        <div>
                          <span className="font-sans font-medium">Local value: </span>
                          <span className="break-all">
                            {entry.source === "database"
                              ? JSON.stringify(entry.localPreview)
                              : (entry.localPreview ?? "missing")}
                          </span>
                        </div>
                        <div>
                          <span className="font-sans font-medium">Incoming value: </span>
                          <span className="break-all">
                            {entry.source === "database"
                              ? JSON.stringify(entry.incomingPreview)
                              : entry.incomingPreview}
                          </span>
                        </div>
                      </td>
                      <td className="p-2">
                        {entry.source === "file" && !entry.targetPath ? (
                          <span>Mapping required</span>
                        ) : entry.kind === "conflict" ? (
                          <select
                            aria-label={`Resolve conflict ${entry.id}`}
                            value={resolutions[entry.id] ?? ""}
                            onChange={(event) =>
                              setResolutions((current) => ({
                                ...current,
                                [entry.id]: event.target.value as Resolution,
                              }))
                            }
                            className="rounded border border-input bg-background p-1"
                          >
                            <option value="">Choose…</option>
                            <option value="keep-local">Keep local</option>
                            <option value="use-incoming">Use incoming</option>
                            <option value="keep-both">
                              Preserve both in conflict artifacts; keep local live
                            </option>
                          </select>
                        ) : (
                          <span>Automatic</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
            <Button
              variant="destructive"
              disabled={busy || unresolved.length > 0 || plan.mappingRequirements.length > 0}
              onClick={() => {
                void run("Binding reviewed import…", async () => {
                  const confirmation = await prepareImportConfirmation.mutateAsync({
                    planId: plan.id,
                    resolutions,
                  })
                  if (
                    !window.confirm(
                      `${importApplyConfirmation(plan.summary)}\n\nConfirmation: ${confirmation.confirmationHash}\nReviewed targets: ${JSON.stringify(confirmation.targetRoots)}`,
                    )
                  )
                    return
                  const result = await applyImport.mutateAsync({
                    planId: plan.id,
                    expectedFingerprint: plan.bundleFingerprint,
                    expectedConfirmationHash: confirmation.confirmationHash,
                    confirmed: true,
                    resolutions,
                  })
                  setLastBackup({ operationId: result.operationId, backupPath: result.backupPath })
                  setStatus(
                    `Import applied: ${result.applied} changes, ${result.skipped} skipped. Backup: ${result.backupPath}${result.conflictArtifactPath ? `. Conflict artifacts: ${result.conflictArtifactPath}` : ""}`,
                  )
                })
              }}
            >
              Apply reviewed import
            </Button>
          </div>
        )}

        {lastBackup && (
          <div className="rounded border border-border p-3 text-sm">
            <p className="font-medium">Latest pre-import backup</p>
            <p className="break-all text-xs text-muted-foreground">{lastBackup.backupPath}</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => {
                if (
                  !window.confirm(
                    "Restore this pre-import backup? Current imported database and files will be replaced.",
                  )
                )
                  return
                void run("Restoring backup…", async () => {
                  await restoreBackup.mutateAsync({
                    operationId: lastBackup.operationId,
                    confirmed: true,
                  })
                  setStatus("Backup restored.")
                })
              }}
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Restore
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            if (
              !window.confirm(
                "Recover interrupted imports now? Incomplete operations will roll back to their recorded backups.",
              )
            )
              return
            void run("Checking recovery journals…", async () => {
              const result = await recover.mutateAsync({ confirmed: true })
              setStatus(`Recovery checked ${result.length} operation(s).`)
            })
          }}
        >
          Check recovery
        </Button>
      </section>

      <section
        className="space-y-4 rounded-lg border border-border p-4"
        data-settings-id="portability-private-sync"
        aria-labelledby="private-sync-title"
      >
        <div>
          <h2 id="private-sync-title" className="font-medium">
            User-owned private git sync
          </h2>
          <p className="text-xs text-muted-foreground">
            Safe file scopes only. No background push, force push, database history, or stored git
            credentials.
          </p>
        </div>
        {privateSync.data ? (
          <div className="space-y-3">
            <div className="rounded bg-muted p-3 text-xs">
              <p className="font-medium">Linked: {privateSync.data.repoPath}</p>
              <p className="break-all">
                {privateSync.data.remote} · {privateSync.data.branch}
              </p>
              <p>{privateSync.data.includedPaths.join(", ")}</p>
            </div>
            <LabeledInput
              label="Commit message"
              value={commitMessage}
              onChange={setCommitMessage}
            />
            <div className="flex flex-wrap gap-2">
              {(["pull", "commit", "push"] as const).map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  onClick={() =>
                    void run(`Previewing ${action}…`, async () => {
                      setSyncPreview(null)
                      setSyncPage(0)
                      const preview = await utils.client.importExport.previewPrivateSync.query({
                        action,
                      })
                      setSyncPreview(preview)
                      setStatus(`${action} preview ready.`)
                    })
                  }
                >
                  Preview {action}
                </Button>
              ))}
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Unlink private sync? The repository and its files will remain untouched.",
                    )
                  )
                    return
                  void run("Unlinking…", async () => {
                    await unlinkSync.mutateAsync({ confirmed: true })
                    await privateSync.refetch()
                    setSyncPreview(null)
                    setSyncPage(0)
                    setStatus("Private sync unlinked. Repository preserved.")
                  })
                }}
              >
                Unlink
              </Button>
            </div>
            {syncPreview && (
              <div className="space-y-2 rounded border border-border p-3 text-xs">
                <p className="font-medium">
                  {syncPreview.action} preview · ahead {syncPreview.ahead} · behind{" "}
                  {syncPreview.behind} · secrets {syncPreview.secretSafe ? "clear" : "blocked"}
                </p>
                <p className="break-all font-mono">
                  Reviewed local OID: {syncPreview.localOid ?? "unborn"}
                </p>
                <p className="break-all font-mono">
                  Reviewed remote OID: {syncPreview.remoteOid ?? "missing branch"}
                </p>
                <p>Approved roots: {syncPreview.includedPaths.join(", ")}</p>
                <ul
                  aria-label="Private sync reviewed files"
                  className="max-h-40 overflow-auto font-mono"
                >
                  {visibleSyncFiles.map((file) => (
                    <li key={`${file.path}:${file.status}`}>
                      {file.status} {file.previousPath ? `${file.previousPath} → ` : ""}
                      {file.path} · {file.oldOid?.slice(0, 12) ?? "none"} →{" "}
                      {file.newOid?.slice(0, 12) ?? "deleted"}
                    </li>
                  ))}
                </ul>
                <nav
                  aria-label="Private sync preview pagination"
                  className="flex items-center justify-between"
                >
                  <Button
                    variant="outline"
                    disabled={syncPage === 0}
                    onClick={() => setSyncPage((value) => value - 1)}
                  >
                    Previous sync files
                  </Button>
                  <span aria-live="polite">
                    Sync page {syncPage + 1} / {syncPageCount}
                  </span>
                  <Button
                    variant="outline"
                    disabled={syncPage + 1 >= syncPageCount}
                    onClick={() => setSyncPage((value) => value + 1)}
                  >
                    Next sync files
                  </Button>
                </nav>
                <Button
                  disabled={!syncPreview.secretSafe || busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        privateSyncConfirmation(syncPreview.action, syncPreview.fingerprint),
                      )
                    )
                      return
                    void run(`Running ${syncPreview.action}…`, async () => {
                      if (syncPreview.action === "pull")
                        await pullSync.mutateAsync({
                          expectedFingerprint: syncPreview.fingerprint,
                          confirmed: true,
                        })
                      else if (syncPreview.action === "commit")
                        await commitSync.mutateAsync({
                          expectedFingerprint: syncPreview.fingerprint,
                          message: commitMessage,
                          confirmed: true,
                        })
                      else
                        await pushSync.mutateAsync({
                          expectedFingerprint: syncPreview.fingerprint,
                          confirmed: true,
                        })
                      setSyncPreview(null)
                      setSyncPage(0)
                      setStatus(`Private sync ${syncPreview.action} complete.`)
                    })
                  }}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  Confirm {syncPreview.action}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <LabeledInput
                  label="Local repository path"
                  value={syncRepo}
                  onChange={setSyncRepo}
                  placeholder="/path/to/private-sync"
                />
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  void chooseDirectory
                    .mutateAsync({ title: "Choose private sync repository" })
                    .then((path) => path && setSyncRepo(path))
                }
              >
                Browse…
              </Button>
            </div>
            <LabeledInput
              label="Private remote"
              value={syncRemote}
              onChange={setSyncRemote}
              placeholder="git@host:user/private.git"
            />
            <LabeledInput label="Branch" value={syncBranch} onChange={setSyncBranch} />
            <fieldset>
              <legend className="text-sm font-medium">Approved sync scopes</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {(capabilities.data?.scopes ?? [])
                  .filter((scope) => scope.privateSync)
                  .map((scope) => (
                    <label key={scope.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={syncScopes.includes(scope.id)}
                        onChange={() => setSyncScopes(toggle(syncScopes, scope.id))}
                      />
                      {scope.label}
                    </label>
                  ))}
              </div>
            </fieldset>
            <Button
              disabled={busy || !syncRepo || !syncRemote || syncScopes.length === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    "Link this user-owned private repository? Flapstack will add origin only when absent and will never store remote credentials.",
                  )
                )
                  return
                void run("Linking private sync…", async () => {
                  await linkSync.mutateAsync({
                    repoPath: syncRepo,
                    remote: syncRemote,
                    branch: syncBranch,
                    scopes: syncScopes,
                    initialize: true,
                    confirmed: true,
                  })
                  await privateSync.refetch()
                  setStatus("Private sync linked.")
                })
              }}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Link private sync
            </Button>
          </div>
        )}
      </section>

      <div aria-live="polite" className="min-h-6 text-sm">
        {busy && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
        {error ? <span className="text-destructive">{error}</span> : status}
      </div>
    </div>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange(value: string): void
  placeholder?: string
}) {
  const id = `portability-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`
  return (
    <label htmlFor={id} className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function toggle<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}
