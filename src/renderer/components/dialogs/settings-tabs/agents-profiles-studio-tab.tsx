import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import {
  AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES,
  DEFAULT_AGENT_CAPABILITY,
  DEFAULT_AGENT_PRESENTATION,
  type AgentProfileDto,
  type AgentProfileVersionInput,
  type ResolvedAgentProfileSnapshot,
} from "../../../../shared/agent-profiles"
import { disabledCustomPermissions } from "../../../../shared/permission-capabilities"
import { runtimeAdapterForPreference } from "../../../../shared/agent-runtime"
import { trpc, trpcClient } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Textarea } from "../../ui/textarea"

const PROFILE_CHANNEL = "flapstack-agent-profiles-v1"
const allCapabilityFields = [
  "role",
  "instructions",
  "harness",
  "runtimePreference",
  "modelPreference",
  "reasoningEffort",
  "tools",
  "skills",
  "permissionMode",
  "customPermissions",
  "memoryPolicy",
  "worktreeStrategy",
  "allowedDescendantProfileIds",
  "maxDescendants",
] as const
const allPresentationFields = [
  "tone",
  "verbosity",
  "formatting",
  "responseStructure",
  "characterLabel",
  "voiceLabel",
  "color",
] as const

type Draft = {
  name: string
  description: string
  category: string
  scopeType: "user" | "project"
  projectId: string
  definition: AgentProfileVersionInput
}

export function AgentsProfilesStudioTab() {
  const utils = trpc.useUtils()
  const projects = trpc.projects.list.useQuery()
  const [projectId, setProjectId] = useState("")
  const [query, setQuery] = useState("")
  const profiles = trpc.agentProfiles.list.useQuery({
    projectId: projectId || undefined,
    query: query || undefined,
    includeArchived: true,
  })
  const diagnostics = trpc.agentProfiles.diagnostics.useQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = profiles.data?.find((profile) => profile.id === selectedId) ?? null
  const details = trpc.agentProfiles.get.useQuery(
    { profileId: selectedId ?? "missing", version: selected?.currentVersion ?? 1 },
    { enabled: Boolean(selectedId && selected) },
  )
  const [draft, setDraft] = useState<Draft>(() => blankDraft(""))
  const [isNew, setIsNew] = useState(true)
  const [status, setStatus] = useState("")
  const [resolved, setResolved] = useState<ResolvedAgentProfileSnapshot | null>(null)
  const [bundleText, setBundleText] = useState("")
  const [importPreview, setImportPreview] = useState<{
    previewId: string
    digest: string
    unresolved: Array<{ kind: string; id: string; reason: string }>
  } | null>(null)
  const [launchDigest, setLaunchDigest] = useState<string | null>(null)
  const [workflowRunId, setWorkflowRunId] = useState("")
  const [workflowStepId, setWorkflowStepId] = useState("")
  const [workflowReference, setWorkflowReference] = useState("")
  const workflowBindings = trpc.agentProfiles.workflowBindings.useQuery(
    { workflowRunId },
    { enabled: Boolean(workflowRunId.trim()) },
  )
  const workflowBinding = workflowBindings.data?.find(
    (item) => item.binding.stepId === workflowStepId,
  )

  useEffect(() => {
    if (!projectId && projects.data?.[0]?.id) {
      const firstProjectId = projects.data[0].id
      setProjectId(firstProjectId)
      if (isNew) setDraft((current) => ({ ...current, projectId: firstProjectId }))
    }
  }, [isNew, projectId, projects.data])

  useEffect(() => {
    if (!details.data) return
    setDraft({
      name: details.data.profile.name,
      description: details.data.profile.description,
      category: details.data.profile.category,
      scopeType: details.data.profile.scope.type === "project" ? "project" : "user",
      projectId:
        details.data.profile.scope.type === "project"
          ? details.data.profile.scope.projectId
          : projectId,
      definition: details.data.version.definition,
    })
    setIsNew(false)
    setResolved(null)
    setLaunchDigest(null)
  }, [details.data, projectId])

  useEffect(() => {
    const channel = new BroadcastChannel(PROFILE_CHANNEL)
    channel.onmessage = () => {
      void utils.agentProfiles.list.invalidate()
      if (selectedId) void utils.agentProfiles.get.invalidate()
    }
    return () => channel.close()
  }, [selectedId, utils])

  const refresh = async (profile?: AgentProfileDto) => {
    await utils.agentProfiles.list.invalidate()
    await utils.agentProfiles.get.invalidate()
    await utils.agentProfiles.diagnostics.invalidate()
    if (profile) setSelectedId(profile.id)
    const channel = new BroadcastChannel(PROFILE_CHANNEL)
    channel.postMessage({ kind: "changed" })
    channel.close()
  }

  const create = trpc.agentProfiles.create.useMutation({
    onSuccess: async (result) => {
      setStatus(`Created ${result.profile.name} v${result.profile.currentVersion}.`)
      await refresh(result.profile)
    },
    onError: (error) => setStatus(error.message),
  })
  const update = trpc.agentProfiles.update.useMutation({
    onSuccess: async (result) => {
      setStatus(`Saved ${result.profile.name} v${result.profile.currentVersion}.`)
      await refresh(result.profile)
    },
    onError: (error) => setStatus(error.message),
  })
  const duplicate = trpc.agentProfiles.duplicate.useMutation({
    onSuccess: async (result) => {
      setStatus(`Duplicated as ${result.profile.name}.`)
      await refresh(result.profile)
    },
    onError: (error) => setStatus(error.message),
  })
  const archive = trpc.agentProfiles.archive.useMutation({
    onSuccess: async (profile) => {
      setStatus(`Archived ${profile.name}. Historical snapshots are unchanged.`)
      await refresh(profile)
    },
    onError: (error) => setStatus(error.message),
  })
  const restore = trpc.agentProfiles.restore.useMutation({
    onSuccess: async (profile) => {
      setStatus(`Restored ${profile.name}.`)
      await refresh(profile)
    },
    onError: (error) => setStatus(error.message),
  })
  const exportProfiles = trpc.agentProfiles.export.useMutation({
    onSuccess: (bundle) => {
      setBundleText(bundle)
      setStatus("Secret-free profile bundle ready.")
    },
    onError: (error) => setStatus(error.message),
  })
  const previewImport = trpc.agentProfiles.importPreview.useMutation({
    onSuccess: (preview) => {
      setImportPreview(preview)
      setStatus("Import parsed. Review disabled requirements before confirmation.")
    },
    onError: (error) => setStatus(error.message),
  })
  const confirmImport = trpc.agentProfiles.importConfirm.useMutation({
    onSuccess: async (created) => {
      setStatus(`Imported ${created.length} untrusted profile(s) with authority disabled.`)
      setImportPreview(null)
      await refresh(created[0])
    },
    onError: (error) => setStatus(error.message),
  })
  const evaluate = trpc.agentProfiles.evaluate.useMutation({
    onSuccess: (result) => setStatus(`Evaluation: ${result.state} (${result.evidenceDigest}).`),
    onError: (error) => setStatus(error.message),
  })
  const launch = trpc.agentProfiles.launchStandalone.useMutation({
    onSuccess: (result) => setStatus(`Named agent launched in chat ${result.chatId}.`),
    onError: (error) => setStatus(error.message),
  })
  const bindWorkflow = trpc.agentProfiles.bindWorkflowStep.useMutation({
    onSuccess: async (result) => {
      setStatus(
        `Bound ${result.binding.workflowRole} to ${result.binding.stepId} at exact profile v${result.binding.profile.version}.`,
      )
      await workflowBindings.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const importWorkflow = trpc.agentProfiles.importWorkflowBinding.useMutation({
    onSuccess: async (result) => {
      setStatus(`Imported exact profile reference for workflow step ${result.binding.stepId}.`)
      await workflowBindings.refetch()
    },
    onError: (error) => setStatus(error.message),
  })
  const confirmWorkflow = trpc.agentProfiles.confirmWorkflowStep.useMutation({
    onSuccess: async (result) => {
      setResolved(result.snapshot)
      setStatus(
        `Confirmed immutable workflow launch snapshot ${result.snapshot.snapshotId}. F3 may now create the durable worker.`,
      )
      await workflowBindings.refetch()
    },
    onError: (error) => setStatus(error.message),
  })

  const busy =
    create.isPending ||
    update.isPending ||
    duplicate.isPending ||
    archive.isPending ||
    restore.isPending

  const policy = useMemo(
    () => ({
      permissionMode: draft.definition.capability.permissionMode,
      customPermissions: draft.definition.capability.customPermissions,
      allowedTools: null,
      allowedSkills: null,
      allowedModels: null,
      allowedRuntimes: null,
      maxDescendants: draft.definition.capability.maxDescendants,
    }),
    [draft.definition.capability],
  )

  const save = () => {
    const scope =
      draft.scopeType === "project"
        ? ({ type: "project", projectId: draft.projectId } as const)
        : ({ type: "user", projectId: null } as const)
    if (isNew) {
      create.mutate({
        name: draft.name,
        description: draft.description,
        category: draft.category,
        scope,
        definition: draft.definition,
      })
      return
    }
    if (!selected) return
    update.mutate({
      profileId: selected.id,
      expectedVersion: selected.currentVersion,
      identity: {
        name: draft.name,
        description: draft.description,
        category: draft.category,
      },
      definition: draft.definition,
    })
  }

  const previewResolved = async () => {
    if (!selected) return
    try {
      const value = await trpcClient.agentProfiles.resolvedPreview.query({
        profile: { profileId: selected.id, version: selected.currentVersion },
        overrides: null,
        policy,
      })
      setResolved(value)
      setStatus(
        value.conflicts.length
          ? `Preview resolved with ${value.conflicts.length} narrowed or blocked field(s).`
          : "Preview resolved without conflicts.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const previewStandalone = async () => {
    if (!selected || !projectId) return
    try {
      const value = await trpcClient.agentProfiles.standalonePreview.query({
        source: { kind: "studio", projectId },
        profile: { profileId: selected.id, version: selected.currentVersion },
        context: { includeTask: false, includeParentChat: false },
        overrides: null,
        orchestrationTaskId: null,
      })
      setResolved(value)
      const blocking = value.conflicts.filter((conflict) =>
        AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
      )
      setLaunchDigest(blocking.length ? null : value.digest)
      setStatus(
        blocking.length
          ? `Standalone launch blocked: ${blocking.map((conflict) => conflict.message).join(" ")}`
          : "Standalone launch preview ready. Confirm to create exactly one chat and run.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      className="grid h-full min-h-0 grid-cols-[minmax(240px,0.75fr)_minmax(460px,1.5fr)]"
      data-settings-id="agent-profile-studio"
    >
      <aside
        className="min-h-0 overflow-y-auto border-r border-border p-4"
        aria-label="Agent Profile list"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Profile Studio</h2>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedId(null)
              setDraft(blankDraft(projectId))
              setIsNew(true)
              setResolved(null)
              setLaunchDigest(null)
            }}
          >
            New
          </Button>
        </div>
        <label className="mb-3 block text-xs font-medium">
          Project scope
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No project selected</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Input
          type="search"
          aria-label="Search Agent Profiles"
          placeholder="Search profiles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-3 space-y-1" role="listbox" aria-label="Agent Profiles">
          {profiles.data?.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="option"
              aria-selected={selectedId === profile.id}
              onClick={() => setSelectedId(profile.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selectedId === profile.id
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:bg-foreground/5"
              }`}
            >
              <span className="block font-medium">{profile.name}</span>
              <span className="block text-xs text-muted-foreground">
                {profile.category} · v{profile.currentVersion} · {profile.source}
                {profile.archivedAt ? " · archived" : ""}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto p-6" aria-label="Agent Profile editor">
        <header className="mb-5">
          <h3 className="text-base font-semibold">{isNew ? "New Agent Profile" : draft.name}</h3>
          <p className="text-sm text-muted-foreground">
            Capability controls authority. Personality controls presentation only.
          </p>
        </header>

        <div className="space-y-5">
          <section
            className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2"
            aria-labelledby="profile-identity-heading"
          >
            <h4 id="profile-identity-heading" className="sm:col-span-2 text-sm font-semibold">
              Identity
            </h4>
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) => patchDraft(setDraft, { name: event.target.value })}
              />
            </Field>
            <Field label="Type/category">
              <Input
                value={draft.category}
                onChange={(event) => patchDraft(setDraft, { category: event.target.value })}
              />
            </Field>
            <Field label="Description" wide>
              <Textarea
                value={draft.description}
                onChange={(event) => patchDraft(setDraft, { description: event.target.value })}
              />
            </Field>
            {isNew && (
              <Field label="Scope">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={draft.scopeType}
                  onChange={(event) =>
                    patchDraft(setDraft, { scopeType: event.target.value as Draft["scopeType"] })
                  }
                >
                  <option value="user">User</option>
                  <option value="project" disabled={!projectId}>
                    Project
                  </option>
                </select>
              </Field>
            )}
            <Field label="Base profile">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={
                  draft.definition.base
                    ? `${draft.definition.base.profileId}@${draft.definition.base.version}`
                    : ""
                }
                onChange={(event) => {
                  const base = profiles.data?.find(
                    (profile) => `${profile.id}@${profile.currentVersion}` === event.target.value,
                  )
                  patchDefinition(setDraft, {
                    base: base ? { profileId: base.id, version: base.currentVersion } : null,
                    inheritCapabilityFields: base ? [...allCapabilityFields] : [],
                    inheritPresentationFields: base ? [...allPresentationFields] : [],
                  })
                }}
              >
                <option value="">No base</option>
                {profiles.data
                  ?.filter((profile) => profile.id !== selectedId && !profile.archivedAt)
                  .map((profile) => (
                    <option key={profile.id} value={`${profile.id}@${profile.currentVersion}`}>
                      {profile.name} v{profile.currentVersion}
                    </option>
                  ))}
              </select>
            </Field>
          </section>

          <CapabilityEditor draft={draft} setDraft={setDraft} />
          <PersonalityEditor draft={draft} setDraft={setDraft} />

          <section
            className="space-y-3 rounded-lg border border-border p-4"
            aria-labelledby="profile-workflow-heading"
          >
            <div>
              <h4 id="profile-workflow-heading" className="text-sm font-semibold">
                Deterministic workflow binding
              </h4>
              <p className="text-xs text-muted-foreground">
                Bind this exact profile version to an existing F3 workflow run and step. Profile
                instructions cannot change topology, budgets, gates, or permissions.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Workflow run ID">
                <Input
                  value={workflowRunId}
                  onChange={(event) => setWorkflowRunId(event.target.value)}
                />
              </Field>
              <Field label="Step ID">
                <Input
                  value={workflowStepId}
                  onChange={(event) => setWorkflowStepId(event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !selected ||
                  !workflowRunId.trim() ||
                  !workflowStepId.trim() ||
                  Boolean(workflowBinding?.snapshotId) ||
                  bindWorkflow.isPending
                }
                onClick={() =>
                  selected &&
                  bindWorkflow.mutate({
                    binding: {
                      schemaVersion: 1,
                      workflowRunId: workflowRunId.trim(),
                      stepId: workflowStepId.trim(),
                      profile: { profileId: selected.id, version: selected.currentVersion },
                      workflowRole: draft.definition.capability.role,
                      inputSchema: null,
                      outputSchema: null,
                      overrides: null,
                    },
                    expectedVersion: workflowBinding?.version ?? 0,
                  })
                }
              >
                {workflowBinding ? "Update future-step binding" : "Bind exact version"}
              </Button>
              <Button
                variant="outline"
                disabled={!workflowBinding}
                onClick={async () => {
                  try {
                    const value = await trpcClient.agentProfiles.exportWorkflowBinding.query({
                      workflowRunId: workflowRunId.trim(),
                      stepId: workflowStepId.trim(),
                    })
                    setWorkflowReference(value)
                    setStatus(
                      "Workflow template reference ready. It contains no resolved authority.",
                    )
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                Export step reference
              </Button>
              <Button
                variant="outline"
                disabled={
                  !workflowBinding ||
                  Boolean(workflowBinding.snapshotId) ||
                  confirmWorkflow.isPending
                }
                onClick={() =>
                  workflowBinding &&
                  confirmWorkflow.mutate({
                    workflowRunId: workflowRunId.trim(),
                    stepId: workflowStepId.trim(),
                    expectedVersion: workflowBinding.version,
                  })
                }
              >
                Confirm safe launch snapshot
              </Button>
              <Button
                variant="outline"
                disabled={
                  !workflowReference.trim() ||
                  !workflowRunId.trim() ||
                  !workflowStepId.trim() ||
                  Boolean(workflowBinding?.snapshotId) ||
                  importWorkflow.isPending
                }
                onClick={() =>
                  importWorkflow.mutate({
                    bundle: workflowReference,
                    workflowRunId: workflowRunId.trim(),
                    stepId: workflowStepId.trim(),
                    expectedVersion: workflowBinding?.version ?? 0,
                  })
                }
              >
                Import step reference
              </Button>
            </div>
            {workflowBinding?.snapshotId && (
              <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
                This step is launch-ready with immutable snapshot {workflowBinding.snapshotId}. F3
                must consume it before creating the durable worker. Fork to a new workflow run or
                step to use an updated profile.
              </p>
            )}
            <Textarea
              aria-label="Workflow Agent Profile template reference"
              className="min-h-24 font-mono text-xs"
              value={workflowReference}
              onChange={(event) => setWorkflowReference(event.target.value)}
              placeholder="Export or paste one versioned workflow profile reference."
            />
          </section>

          <section
            className="space-y-3 rounded-lg border border-border p-4"
            aria-labelledby="profile-preview-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 id="profile-preview-heading" className="text-sm font-semibold">
                  Resolved preview and evidence
                </h4>
                <p className="text-xs text-muted-foreground">
                  Every source, compatibility result, and authority narrowing stays inspectable.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!selected}
                  onClick={() => void previewResolved()}
                >
                  Preview resolved
                </Button>
                <Button
                  variant="outline"
                  disabled={!selected}
                  onClick={() =>
                    selected &&
                    evaluate.mutate({
                      profile: { profileId: selected.id, version: selected.currentVersion },
                      runtime:
                        runtimeAdapterForPreference(
                          draft.definition.capability.runtimePreference,
                        ) ??
                        (draft.definition.capability.harness === "codex"
                          ? "codex"
                          : draft.definition.capability.harness === "claude-code"
                            ? "claude-code"
                            : "flapstack-native"),
                      model: draft.definition.capability.modelPreference ?? "default-unpinned",
                      fixtures: [
                        "schema",
                        "capability",
                        "permission",
                        "prompt-injection",
                        "determinism",
                        "task-quality",
                      ],
                    })
                  }
                >
                  Test locally
                </Button>
                <Button
                  variant="outline"
                  disabled={!selected || !projectId}
                  onClick={() => void previewStandalone()}
                >
                  Preview Start Agent
                </Button>
                <Button
                  disabled={!selected || !launchDigest || launch.isPending}
                  onClick={() =>
                    selected &&
                    launchDigest &&
                    launch.mutate({
                      requestId: crypto.randomUUID(),
                      source: { kind: "studio", projectId },
                      profile: { profileId: selected.id, version: selected.currentVersion },
                      context: { includeTask: false, includeParentChat: false },
                      overrides: null,
                      orchestrationTaskId: null,
                      confirmedSnapshotDigest: launchDigest,
                    })
                  }
                >
                  Start agent
                </Button>
              </div>
            </div>
            {resolved && <ResolvedPreview value={resolved} />}
          </section>

          <section
            className="space-y-3 rounded-lg border border-border p-4"
            aria-labelledby="profile-portability-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 id="profile-portability-heading" className="text-sm font-semibold">
                  Local portability
                </h4>
                <p className="text-xs text-muted-foreground">
                  No secrets, hosted marketplace, remote update, or inherited authority.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={!selected}
                  onClick={() =>
                    selected &&
                    exportProfiles.mutate({
                      profiles: [{ profileId: selected.id, version: selected.currentVersion }],
                    })
                  }
                >
                  Export selected
                </Button>
                <Button
                  variant="outline"
                  disabled={!bundleText.trim()}
                  onClick={() =>
                    previewImport.mutate({
                      bundle: bundleText,
                      sourceLabel: "Profile Studio paste",
                    })
                  }
                >
                  Preview import
                </Button>
                <Button
                  disabled={!importPreview}
                  onClick={() =>
                    importPreview &&
                    confirmImport.mutate({
                      previewId: importPreview.previewId,
                      expectedDigest: importPreview.digest,
                      conflict: "duplicate",
                      projectId: draft.scopeType === "project" ? projectId : null,
                    })
                  }
                >
                  Confirm constrained import
                </Button>
              </div>
            </div>
            <Textarea
              aria-label="Agent Profile export or import bundle"
              className="min-h-32 font-mono text-xs"
              value={bundleText}
              onChange={(event) => {
                setBundleText(event.target.value)
                setImportPreview(null)
              }}
              placeholder="Export appears here, or paste a versioned profile bundle for preview."
            />
            {importPreview && (
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {importPreview.unresolved.map((item, index) => (
                  <li key={`${item.kind}-${item.id}-${index}`}>
                    {item.kind} {item.id}: {item.reason}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {diagnostics.data && (
            <section
              className="space-y-3 rounded-lg border border-border p-4"
              aria-labelledby="profile-diagnostics-heading"
            >
              <h4 id="profile-diagnostics-heading" className="text-sm font-semibold">
                Diagnostics
              </h4>
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <Fact
                  label="Profiles / versions"
                  value={`${diagnostics.data.counts.profiles} / ${diagnostics.data.counts.versions}`}
                />
                <Fact
                  label="Snapshots / launches"
                  value={`${diagnostics.data.counts.snapshots} / ${diagnostics.data.counts.standaloneLaunches}`}
                />
                <Fact
                  label="Local / supported evidence"
                  value={`${diagnostics.data.counts.testedLocal} / ${diagnostics.data.counts.supported}`}
                />
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {diagnostics.data.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {status || "Ready."}
            </p>
            <div className="flex gap-2">
              {!isNew && selected && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    duplicate.mutate({
                      profile: { profileId: selected.id, version: selected.currentVersion },
                      name: `${selected.name} copy`,
                      scope: { type: "user", projectId: null },
                    })
                  }
                >
                  Duplicate
                </Button>
              )}
              {!isNew && selected && selected.source !== "built-in" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    (selected.archivedAt ? restore : archive).mutate({
                      profileId: selected.id,
                      expectedVersion: selected.currentVersion,
                    })
                  }
                >
                  {selected.archivedAt ? "Restore" : "Archive"}
                </Button>
              )}
              <Button disabled={busy || (!isNew && selected?.source === "built-in")} onClick={save}>
                {isNew ? "Create profile" : "Save new version"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function CapabilityEditor({
  draft,
  setDraft,
}: {
  draft: Draft
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
}) {
  const capability = draft.definition.capability
  const patch = (value: Partial<typeof capability>) =>
    setDraft((current) => ({
      ...current,
      definition: {
        ...current.definition,
        capability: { ...current.definition.capability, ...value },
      },
    }))
  return (
    <section
      className="grid gap-3 rounded-lg border-2 border-primary/25 p-4 sm:grid-cols-2"
      aria-labelledby="profile-capability-heading"
    >
      <div className="sm:col-span-2">
        <h4 id="profile-capability-heading" className="text-sm font-semibold">
          Capability
        </h4>
        <p className="text-xs text-muted-foreground">
          Authority-bearing fields. Current policy may only narrow them.
        </p>
      </div>
      <Field label="Role">
        <Input value={capability.role} onChange={(event) => patch({ role: event.target.value })} />
      </Field>
      <Field label="Harness">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={capability.harness}
          onChange={(event) => patch({ harness: event.target.value as typeof capability.harness })}
        >
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
        </select>
      </Field>
      <Field label="Instructions" wide>
        <Textarea
          className="min-h-28"
          value={capability.instructions}
          onChange={(event) => patch({ instructions: event.target.value })}
        />
      </Field>
      <Field label="Runtime">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={capability.runtimePreference}
          onChange={(event) =>
            patch({ runtimePreference: event.target.value as typeof capability.runtimePreference })
          }
        >
          <option value="auto">Automatic</option>
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
          <option value="flapstack-native">Flapstack Native</option>
        </select>
      </Field>
      <Field label="Model preference">
        <Input
          value={capability.modelPreference ?? ""}
          placeholder="Unpinned"
          onChange={(event) => patch({ modelPreference: event.target.value.trim() || null })}
        />
      </Field>
      <Field label="Permission ceiling">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={capability.permissionMode}
          onChange={(event) => {
            const mode = event.target.value as typeof capability.permissionMode
            patch({
              permissionMode: mode,
              customPermissions: mode === "custom" ? disabledCustomPermissions : null,
            })
          }}
        >
          <option value="read-only">Read only</option>
          <option value="ask-before-edits">Ask before edits</option>
          <option value="auto-edit-project-only">Project edits</option>
          <option value="full-access">Full access</option>
          <option value="custom">Custom (all disabled initially)</option>
        </select>
      </Field>
      <Field label="Worktree">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={capability.worktreeStrategy}
          onChange={(event) =>
            patch({ worktreeStrategy: event.target.value as typeof capability.worktreeStrategy })
          }
        >
          <option value="inherit">Inherit launch context</option>
          <option value="task-primary">Task primary</option>
          <option value="none">No worktree</option>
          <option value="existing">Explicit existing at launch</option>
          <option value="attached-branch">Explicit branch at launch</option>
        </select>
      </Field>
      <Field label="Tools (comma separated)">
        <Input
          value={capability.tools.join(", ")}
          onChange={(event) => patch({ tools: csv(event.target.value) })}
        />
      </Field>
      <Field label="Skills (comma separated)">
        <Input
          value={capability.skills.join(", ")}
          onChange={(event) => patch({ skills: csv(event.target.value) })}
        />
      </Field>
      <Field label="Max descendants">
        <Input
          type="number"
          min={0}
          max={64}
          value={capability.maxDescendants}
          onChange={(event) => patch({ maxDescendants: Number(event.target.value) })}
        />
      </Field>
      <Field label="Memory">
        <Input value="None — persistent profile memory disabled" disabled />
      </Field>
    </section>
  )
}

function PersonalityEditor({
  draft,
  setDraft,
}: {
  draft: Draft
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
}) {
  const style = draft.definition.presentation
  const patch = (value: Partial<typeof style>) =>
    setDraft((current) => ({
      ...current,
      definition: {
        ...current.definition,
        presentation: { ...current.definition.presentation, ...value },
      },
    }))
  return (
    <section
      className="grid gap-3 rounded-lg border border-violet-400/40 p-4 sm:grid-cols-2"
      aria-labelledby="profile-personality-heading"
    >
      <div className="sm:col-span-2">
        <h4 id="profile-personality-heading" className="text-sm font-semibold">
          Personality and presentation
        </h4>
        <p className="text-xs text-muted-foreground">
          Tone and display identity. These fields never grant tools, permissions, memory,
          descendants, Runtime, or model authority.
        </p>
      </div>
      <Field label="Tone">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={style.tone}
          onChange={(event) => patch({ tone: event.target.value as typeof style.tone })}
        >
          <option value="neutral">Neutral</option>
          <option value="direct">Direct</option>
          <option value="warm">Warm</option>
          <option value="formal">Formal</option>
          <option value="playful">Playful</option>
        </select>
      </Field>
      <Field label="Verbosity">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={style.verbosity}
          onChange={(event) => patch({ verbosity: event.target.value as typeof style.verbosity })}
        >
          <option value="terse">Terse</option>
          <option value="balanced">Balanced</option>
          <option value="detailed">Detailed</option>
        </select>
      </Field>
      <Field label="Formatting">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={style.formatting}
          onChange={(event) => patch({ formatting: event.target.value as typeof style.formatting })}
        >
          <option value="plain">Plain</option>
          <option value="structured">Structured</option>
          <option value="markdown">Markdown</option>
        </select>
      </Field>
      <Field label="Color">
        <Input
          type="color"
          value={style.color ?? "#5965f3"}
          onChange={(event) => patch({ color: event.target.value })}
        />
      </Field>
      <Field label="Response structure" wide>
        <Textarea
          value={style.responseStructure}
          onChange={(event) => patch({ responseStructure: event.target.value })}
        />
      </Field>
      <Field label="Character label">
        <Input
          value={style.characterLabel ?? ""}
          onChange={(event) => patch({ characterLabel: event.target.value.trim() || null })}
        />
      </Field>
      <Field label="Voice label">
        <Input
          value={style.voiceLabel ?? ""}
          onChange={(event) => patch({ voiceLabel: event.target.value.trim() || null })}
        />
        <span className="text-xs text-muted-foreground">
          Display label only. Audio voice stays in Voice settings.
        </span>
      </Field>
    </section>
  )
}

function ResolvedPreview({ value }: { value: ResolvedAgentProfileSnapshot }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-3">
        <Fact label="Digest" value={value.digest} />
        <Fact label="Runtime" value={value.evaluation.runtime} />
        <Fact label="Evaluation" value={value.evaluation.state} />
      </div>
      {value.conflicts.length > 0 && (
        <ul className="space-y-1 text-amber-700 dark:text-amber-300">
          {value.conflicts.map((conflict) => (
            <li key={`${conflict.code}-${conflict.field}`}>
              <strong>{conflict.field}:</strong> {conflict.message} {conflict.repair}
            </li>
          ))}
        </ul>
      )}
      {value.unresolvedRequirements.length > 0 && (
        <div>
          <strong>Disabled imported requirements</strong>
          <ul className="mt-1 space-y-1 text-amber-700 dark:text-amber-300">
            {value.unresolvedRequirements.map((requirement) => (
              <li key={`${requirement.kind}-${requirement.id}`}>
                {requirement.kind} {requirement.id}: {requirement.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">
          Field sources ({Object.keys(value.sources).length})
        </summary>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          {Object.entries(value.sources).map(([field, source]) => (
            <div key={field} className="rounded border border-border p-2">
              <dt className="font-mono">{field}</dt>
              <dd className="text-muted-foreground">
                {source.layer}
                {source.profileId ? ` · ${source.profileId}@${source.version}` : ""} · {source.note}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`space-y-1 text-xs font-medium ${wide ? "sm:col-span-2" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <span className="block text-muted-foreground">{label}</span>
      <span className="break-all font-mono">{value}</span>
    </div>
  )
}

function blankDraft(projectId: string): Draft {
  return {
    name: "",
    description: "",
    category: "custom",
    scopeType: "user",
    projectId,
    definition: {
      base: null,
      capability: structuredClone(DEFAULT_AGENT_CAPABILITY),
      presentation: structuredClone(DEFAULT_AGENT_PRESENTATION),
      inheritCapabilityFields: [],
      inheritPresentationFields: [],
    },
  }
}

function patchDraft(
  setDraft: Dispatch<SetStateAction<Draft>>,
  value: Partial<Omit<Draft, "definition">>,
) {
  setDraft((current) => ({ ...current, ...value }))
}
function patchDefinition(
  setDraft: Dispatch<SetStateAction<Draft>>,
  value: Partial<AgentProfileVersionInput>,
) {
  setDraft((current) => ({ ...current, definition: { ...current.definition, ...value } }))
}
function csv(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}
