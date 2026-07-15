import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import {
  orchestrationTemplateDefinitionSchema,
  type OrchestrationTemplateDefinition,
} from "../../../shared/orchestration-operations"
import {
  orchestrationAgentDefinitionSchema,
  type OrchestrationAgentDefinition,
} from "../../../shared/agent-orchestration"
import { recordOrchestrationTransition } from "./activity-projection"
import { verifyAndConsumeTemplateLaunchApproval } from "./operations-config"
import type { RuntimeLaunchCoordinatorPort, RuntimeLaunchReference } from "./runtime-launch-port"
import { createAgentOrchestrationService } from "./service"
import {
  identityWorkflowAgentMaterializer,
  type WorkflowAgentMaterializationResult,
  type WorkflowAgentMaterializerPort,
} from "./worker-materializer-port"

type Row = Record<string, unknown>
type Step = OrchestrationTemplateDefinition["workflow"]["steps"][number]
type CheckpointStatus =
  "pending" | "running" | "waiting" | "blocked" | "completed" | "failed" | "uncertain" | "skipped"

export type WorkflowWorkerLaunch = {
  stepId: string
  runId: string
  chatId: string
  subChatId: string
}

export type WorkflowRunDto = {
  id: string
  taskId: string
  status:
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "paused"
    | "completed"
    | "failed"
    | "stopped"
    | "uncertain"
  approvalAuditId: string | null
  definition: OrchestrationTemplateDefinition
  checkpoints: Array<{
    stepId: string
    status: CheckpointStatus
    attemptCount: number
    output: unknown
    error: string | null
  }>
}

export class WorkflowEngine {
  constructor(
    private readonly databasePath: string,
    private readonly coordinator: RuntimeLaunchCoordinatorPort,
    private readonly materializer: WorkflowAgentMaterializerPort = identityWorkflowAgentMaterializer,
  ) {}

  preview(definitionValue: unknown) {
    const definition = orchestrationTemplateDefinitionSchema.parse(definitionValue)
    validateWorkflow(definition.workflow.steps)
    const executableSteps = definition.workflow.steps.filter((step) =>
      ["agent", "synthesis"].includes(step.kind),
    ).length
    return {
      stepCount: definition.workflow.steps.length,
      workerCount: executableSteps,
      maxConcurrency: Math.min(
        definition.policy.maxParallelAgents,
        definition.policy.maxTotalAgents,
      ),
      warnings: [
        ...(definition.workflow.steps.length > 100
          ? ["Large workflow: review cost and concurrency before launch."]
          : []),
        ...(executableSteps > definition.policy.maxTotalAgents
          ? ["Workflow worker steps exceed maxTotalAgents and will block before excess launches."]
          : []),
        ...(definition.workflow.steps.some((step) => step.outputSchema !== null)
          ? [
              "Structured worker outputs are validated against referenced Runtime activity and fail closed when missing or invalid.",
            ]
          : []),
      ],
    }
  }

  start(
    taskId: string,
    definitionValue: unknown,
    approvalAuditId: string | null = null,
  ): WorkflowRunDto {
    const definition = orchestrationTemplateDefinitionSchema.parse(definitionValue)
    validateWorkflow(definition.workflow.steps)
    const db = new Database(this.databasePath)
    const id = randomUUID()
    const now = epoch()
    try {
      const tx = db.transaction(() => {
        const orchestration = db
          .prepare("SELECT status FROM task_orchestrations WHERE task_id = ?")
          .get(taskId) as { status: string } | undefined
        if (!orchestration) throw new Error("Orchestration does not exist.")
        if (["stopped", "completed", "failed"].includes(orchestration.status))
          throw new Error("Orchestration does not permit new workflow launches.")
        verifyAndConsumeTemplateLaunchApproval(db, taskId, definition, approvalAuditId)
        db.prepare(
          `INSERT INTO orchestration_workflow_runs
           (id, task_id, status, definition_json, approval_audit_id, stop_intent, created_at, updated_at)
           VALUES (?, ?, 'queued', ?, ?, 0, ?, ?)`,
        ).run(id, taskId, JSON.stringify(definition), approvalAuditId, now, now)
        const insert = db.prepare(
          `INSERT INTO orchestration_workflow_checkpoints
           (workflow_run_id, step_id, status, output_json, error, attempt_count, updated_at)
           VALUES (?, ?, 'pending', NULL, NULL, 0, ?)`,
        )
        for (const step of definition.workflow.steps) insert.run(id, step.id, now)
        recordOrchestrationTransition(db, {
          dedupKey: `workflow:${id}:queued:${now}`,
          taskId,
          entityType: "workflow",
          entityId: id,
          kind: "workflow-phase",
          phase: "queued",
          createdAt: now,
        })
      })
      tx.immediate()
      return this.get(id)
    } finally {
      db.close()
    }
  }

  async advance(
    runId: string,
    launches: Record<string, Omit<WorkflowWorkerLaunch, "stepId">> = {},
  ): Promise<WorkflowRunDto> {
    let run = this.get(runId)
    if (["completed", "failed", "stopped"].includes(run.status) || run.status === "paused")
      return run
    const db = new Database(this.databasePath)
    try {
      const state = db
        .prepare("SELECT stop_intent FROM orchestration_workflow_runs WHERE id = ?")
        .get(runId) as { stop_intent: number }
      if (state.stop_intent) {
        this.setRunStatus(db, run, "stopped")
        return this.get(runId)
      }
      this.setRunStatus(db, run, "running", ["queued", "waiting", "blocked", "uncertain"])
      this.recoverMaterializationClaims(db, run)
      await this.reconcileActive(db, run)
      run = this.get(runId)
      this.prepareCompletedLoopIterations(db, run)
      run = this.get(runId)
      if (run.checkpoints.some((checkpoint) => checkpoint.status === "uncertain")) {
        this.setRunStatus(db, run, "uncertain")
        return this.get(runId)
      }

      const checkpoints = new Map(
        run.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]),
      )
      const workerLaunches: Promise<void>[] = []
      let scheduledWorkers = 0
      for (const step of run.definition.workflow.steps) {
        const checkpoint = checkpoints.get(step.id)!
        if (checkpoint.status !== "pending") continue
        if (!step.dependsOn.every((id) => terminalSuccess(checkpoints.get(id)?.status))) continue
        if (["agent", "synthesis"].includes(step.kind)) {
          if (!this.withinLaunchLimits(db, run, checkpoints, scheduledWorkers)) {
            this.setCheckpoint(
              db,
              run,
              step,
              "blocked",
              checkpoint.output,
              "Workflow policy spawn, concurrency, agent, token, or cost limit reached.",
              checkpoint.attemptCount,
            )
            continue
          }
          let launch = launches[step.id]
          let materializedSnapshot: WorkflowAgentMaterializationResult | undefined
          if (!launch) {
            if (!step.agentDefinitionId)
              throw new Error(`Workflow worker ${step.id} is missing its agent definition binding.`)
            const definition = run.definition.agents.find(
              (candidate) => candidate.definitionId === step.agentDefinitionId,
            )
            if (!definition)
              throw new Error(`Workflow worker ${step.id} references an unknown agent definition.`)
            const service = createAgentOrchestrationService(this.databasePath)
            const attemptCount = checkpoint.attemptCount + 1
            service.assertWorkflowAgentEligible({
              taskId: run.taskId,
              workflowRunId: run.id,
              stepId: step.id,
              attemptCount,
              agentDefinition: definition,
            })
            const snapshot = await this.materializeDefinition(db, run, step, checkpoint, definition)
            if (!snapshot) continue
            const control = db
              .prepare("SELECT status, stop_intent FROM orchestration_workflow_runs WHERE id = ?")
              .get(run.id) as { status: string; stop_intent: number }
            if (control.stop_intent) {
              this.setRunStatus(db, this.get(run.id), "stopped")
              return this.get(run.id)
            }
            if (control.status === "paused") return this.get(run.id)
            let materialized: ReturnType<typeof service.materializeWorkflowAgent>
            try {
              materialized = service.materializeWorkflowAgent({
                taskId: run.taskId,
                workflowRunId: run.id,
                stepId: step.id,
                attemptCount,
                agentDefinition: snapshot.agentDefinition,
              })
            } catch (error) {
              const racedControl = db
                .prepare("SELECT status, stop_intent FROM orchestration_workflow_runs WHERE id = ?")
                .get(run.id) as { status: string; stop_intent: number }
              if (racedControl.stop_intent) {
                this.setRunStatus(db, this.get(run.id), "stopped")
                return this.get(run.id)
              }
              if (racedControl.status === "paused") return this.get(run.id)
              throw error
            }
            launch = materialized
            materializedSnapshot = snapshot
          }
          workerLaunches.push(
            this.launchWorker(db, run, step, checkpoint.attemptCount, launch, materializedSnapshot),
          )
          scheduledWorkers += 1
          continue
        }
        this.evaluateControlStep(db, run, step, checkpoints)
        for (const updated of this.get(run.id).checkpoints) checkpoints.set(updated.stepId, updated)
      }
      const launchResults = await Promise.allSettled(workerLaunches)
      const rejectedLaunch = launchResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      )
      if (rejectedLaunch) throw rejectedLaunch.reason
      this.evaluateReadyControlSteps(db, run.id)
      run = this.get(runId)
      this.prepareCompletedLoopIterations(db, run)
      run = this.get(runId)
      this.refreshRunStatus(db, run)
      const result = this.get(runId)
      const resultCheckpoints = new Map(
        result.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]),
      )
      const readyWorker = result.definition.workflow.steps.some((step) => {
        const checkpoint = resultCheckpoints.get(step.id)
        return (
          ["agent", "synthesis"].includes(step.kind) &&
          checkpoint?.status === "pending" &&
          step.dependsOn.every((id) => terminalSuccess(resultCheckpoints.get(id)?.status))
        )
      })
      return readyWorker ? await this.advance(runId, launches) : result
    } finally {
      db.close()
    }
  }

  decideHumanGate(runId: string, stepId: string, decision: "approve" | "deny") {
    const db = new Database(this.databasePath)
    try {
      const run = this.get(runId)
      const step = requireStep(run, stepId, "human-gate")
      const checkpoint = requireCheckpoint(run, stepId)
      if (checkpoint.status !== "waiting") throw new Error("Human gate is not waiting.")
      const output = { decision }
      assertOutput(step, output)
      this.setCheckpoint(
        db,
        run,
        step,
        decision === "approve" ? "completed" : "failed",
        output,
        decision === "approve" ? null : "Human gate denied.",
        checkpoint.attemptCount,
      )
      this.refreshRunStatus(db, this.get(runId))
      return this.get(runId)
    } finally {
      db.close()
    }
  }

  resolveLoop(runId: string, stepId: string, input: { continue: boolean; output: unknown }) {
    const db = new Database(this.databasePath)
    try {
      const run = this.get(runId)
      const step = requireStep(run, stepId, "loop")
      const checkpoint = requireCheckpoint(run, stepId)
      if (checkpoint.status !== "waiting") throw new Error("Loop is not waiting for resolution.")
      const previous = asRecord(checkpoint.output)
      const priorIteration = Number(previous?.iteration ?? 0)
      if (input.continue && priorIteration >= step.maxIterations)
        throw new Error("Loop maxIterations reached; continuation denied.")
      const iteration = input.continue ? priorIteration + 1 : priorIteration
      const output = { iteration, continue: input.continue, value: input.output }
      if (!input.continue) assertOutput(step, input.output)
      if (input.continue) {
        for (const bodyStepId of step.bodyStepIds) {
          const bodyStep = requireStep(run, bodyStepId)
          const bodyCheckpoint = requireCheckpoint(run, bodyStepId)
          if (terminalSuccess(bodyCheckpoint.status))
            this.setCheckpoint(
              db,
              run,
              bodyStep,
              "pending",
              null,
              null,
              bodyCheckpoint.attemptCount,
            )
        }
      }
      this.setCheckpoint(db, run, step, "completed", output, null, checkpoint.attemptCount)
      this.refreshRunStatus(db, this.get(runId))
      return this.get(runId)
    } finally {
      db.close()
    }
  }

  retryStep(runId: string, stepId: string) {
    const db = new Database(this.databasePath)
    try {
      const run = this.get(runId)
      const step = requireStep(run, stepId)
      const checkpoint = requireCheckpoint(run, stepId)
      if (!["waiting", "failed", "blocked"].includes(checkpoint.status))
        throw new Error("Checkpoint is not retryable.")
      if (checkpoint.attemptCount > step.maxRetries)
        throw new Error("Checkpoint retry policy is exhausted.")
      this.setCheckpoint(db, run, step, "pending", null, null, checkpoint.attemptCount)
      this.setRunStatus(db, run, "running")
      return this.get(runId)
    } finally {
      db.close()
    }
  }

  control(runId: string, action: "pause" | "resume" | "stop"): WorkflowRunDto {
    const db = new Database(this.databasePath)
    try {
      const run = this.get(runId)
      if (action === "stop") {
        db.prepare(
          `UPDATE orchestration_workflow_runs
           SET stop_intent = 1,
               status = CASE WHEN status in ('queued','waiting','blocked','paused') THEN 'stopped' ELSE status END,
               updated_at = ? WHERE id = ?`,
        ).run(epoch(), runId)
      } else if (action === "pause") {
        db.prepare(
          `UPDATE orchestration_workflow_runs SET status = 'paused', updated_at = ?
           WHERE id = ? AND status in ('queued','running','waiting','blocked')`,
        ).run(epoch(), runId)
      } else {
        db.prepare(
          `UPDATE orchestration_workflow_runs SET status = 'running', updated_at = ?
           WHERE id = ? AND status = 'paused' AND stop_intent = 0`,
        ).run(epoch(), runId)
      }
      const changed = this.get(runId)
      if (changed.status !== run.status)
        recordOrchestrationTransition(db, {
          dedupKey: `workflow:${runId}:${changed.status}:${epoch()}`,
          taskId: run.taskId,
          entityType: "workflow",
          entityId: runId,
          kind: "workflow-phase",
          phase: changed.status,
        })
      return changed
    } finally {
      db.close()
    }
  }

  get(runId: string): WorkflowRunDto {
    const db = new Database(this.databasePath)
    try {
      const row = db
        .prepare("SELECT * FROM orchestration_workflow_runs WHERE id = ?")
        .get(runId) as Row | undefined
      if (!row) throw new Error("Workflow run not found.")
      const checkpoints = db
        .prepare(
          "SELECT * FROM orchestration_workflow_checkpoints WHERE workflow_run_id = ? ORDER BY rowid",
        )
        .all(runId) as Row[]
      return {
        id: String(row.id),
        taskId: String(row.task_id),
        status: row.status as WorkflowRunDto["status"],
        approvalAuditId: row.approval_audit_id ? String(row.approval_audit_id) : null,
        definition: orchestrationTemplateDefinitionSchema.parse(
          JSON.parse(String(row.definition_json)),
        ),
        checkpoints: checkpoints.map((item) => ({
          stepId: String(item.step_id),
          status: String(item.status) as CheckpointStatus,
          attemptCount: Number(item.attempt_count ?? 0),
          output: item.output_json ? JSON.parse(String(item.output_json)) : null,
          error: item.error === null ? null : String(item.error),
        })),
      }
    } finally {
      db.close()
    }
  }

  list(taskId: string): WorkflowRunDto[] {
    const db = new Database(this.databasePath, { readonly: true })
    let ids: string[]
    try {
      ids = (
        db
          .prepare(
            "SELECT id FROM orchestration_workflow_runs WHERE task_id = ? ORDER BY created_at DESC, id DESC",
          )
          .all(taskId) as Array<{ id: string }>
      ).map((row) => row.id)
    } finally {
      db.close()
    }
    return ids.map((id) => this.get(id))
  }

  private async reconcileActive(db: Database.Database, run: WorkflowRunDto) {
    for (const checkpoint of run.checkpoints.filter((item) =>
      ["running", "uncertain"].includes(item.status),
    )) {
      const step = requireStep(run, checkpoint.stepId)
      const persisted = asRecord(checkpoint.output)
      const runtimeRunId = typeof persisted?.runId === "string" ? persisted.runId : null
      if (!runtimeRunId) continue
      const startedAt = Number(persisted?.startedAt ?? 0)
      if (step.timeoutMs && startedAt && Date.now() - startedAt * 1000 >= step.timeoutMs) {
        try {
          await this.coordinator.cancel(runtimeRunId, `workflow-timeout:${run.id}:${step.id}`)
        } finally {
          this.setCheckpoint(
            db,
            run,
            step,
            "failed",
            checkpoint.output,
            "Workflow checkpoint timed out.",
            checkpoint.attemptCount,
          )
        }
        continue
      }
      try {
        const reference = await this.coordinator.reconcile(runtimeRunId)
        if (reference.runId !== runtimeRunId)
          throw new Error("Runtime reconciliation identity mismatch.")
        await this.applyRuntimeReference(db, run, step, checkpoint, reference)
      } catch (error) {
        this.setCheckpoint(
          db,
          run,
          step,
          "uncertain",
          checkpoint.output,
          safeError(error),
          checkpoint.attemptCount,
        )
      }
    }
  }

  private prepareCompletedLoopIterations(db: Database.Database, run: WorkflowRunDto) {
    const checkpoints = new Map(
      run.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]),
    )
    for (const step of run.definition.workflow.steps.filter((item) => item.kind === "loop")) {
      const loop = checkpoints.get(step.id)
      const output = asRecord(loop?.output)
      if (loop?.status !== "completed" || output?.continue !== true) continue
      const body = step.bodyStepIds.map((id) => checkpoints.get(id))
      if (!body.every((checkpoint) => checkpoint && terminalSuccess(checkpoint.status))) continue
      this.setCheckpoint(
        db,
        run,
        step,
        "waiting",
        { iteration: Number(output.iteration ?? 0), continue: null },
        "Loop iteration completed; explicit continuation decision required.",
        loop.attemptCount,
      )
    }
  }

  private async launchWorker(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    priorAttempts: number,
    launch: Omit<WorkflowWorkerLaunch, "stepId">,
    materializedSnapshot?: WorkflowAgentMaterializationResult,
  ) {
    if (!step.agentDefinitionId)
      throw new Error(`Workflow worker ${step.id} is missing its agent definition binding.`)
    const agentDefinition =
      materializedSnapshot?.agentDefinition ??
      run.definition.agents.find((candidate) => candidate.definitionId === step.agentDefinitionId)
    if (!agentDefinition)
      throw new Error(`Workflow worker ${step.id} references an unknown agent definition.`)
    const request = {
      ...launch,
      taskId: run.taskId,
      agentDefinitionId: step.agentDefinitionId,
      agentDefinition,
      outputSchema: step.outputSchema,
    }
    const attemptCount = priorAttempts + 1
    const ownership = { workflowRunId: run.id, stepId: step.id, attemptCount }
    const binding = await this.coordinator.reserve(request, ownership)
    if (binding.agentDefinitionId !== step.agentDefinitionId)
      throw new Error("Runtime launch agent definition binding mismatch.")
    const durableLaunch = {
      runId: launch.runId,
      chatId: launch.chatId,
      subChatId: launch.subChatId,
      orchestrationAgentId: binding.orchestrationAgentId,
      agentDefinitionId: binding.agentDefinitionId,
      lifecycle: "pending",
      activityReference: null,
      startedAt: epoch(),
      ...(materializedSnapshot
        ? {
            materialization: {
              state: "materialized",
              attemptCount,
              ...materializedSnapshot,
            },
          }
        : {}),
    }
    const claim = db.transaction(() => {
      const claimed = db
        .prepare(
          `UPDATE orchestration_workflow_checkpoints
           SET status = 'running', output_json = ?, error = NULL, attempt_count = ?, updated_at = ?
           WHERE workflow_run_id = ? AND step_id = ? AND status = 'pending'`,
        )
        .run(JSON.stringify(durableLaunch), attemptCount, epoch(), run.id, step.id)
      if (claimed.changes !== 1) throw new Error("Workflow checkpoint claim was lost.")
      this.recordCheckpoint(db, run, step, "running", attemptCount, launch.runId)
    })
    claim.immediate()
    try {
      const reference = await this.coordinator.launch(request, ownership)
      assertReferenceMatches(launch, reference)
      await this.applyRuntimeReference(
        db,
        run,
        step,
        { stepId: step.id, status: "running", attemptCount, output: durableLaunch, error: null },
        reference,
      )
    } catch (error) {
      this.setCheckpoint(db, run, step, "uncertain", durableLaunch, safeError(error), attemptCount)
    }
  }

  private async materializeDefinition(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    checkpoint: WorkflowRunDto["checkpoints"][number],
    definition: OrchestrationAgentDefinition,
  ): Promise<WorkflowAgentMaterializationResult | null> {
    const persisted = materializationSnapshot(checkpoint.output)
    if (persisted) return persisted
    const owner = randomUUID()
    const attemptCount = checkpoint.attemptCount + 1
    const claimed = db
      .prepare(
        `UPDATE orchestration_workflow_checkpoints
         SET status = 'waiting', output_json = ?, error = NULL, updated_at = ?
         WHERE workflow_run_id = ? AND step_id = ? AND status = 'pending'
           AND attempt_count = ?`,
      )
      .run(
        JSON.stringify({
          materialization: {
            state: "materializing",
            attemptCount,
            leaseOwner: owner,
            leaseExpiresAt: epoch() + 60,
          },
        }),
        epoch(),
        run.id,
        step.id,
        checkpoint.attemptCount,
      )
    if (claimed.changes !== 1) return null
    let renewalLost = false
    const renewal = setInterval(() => {
      try {
        const renewed = db
          .prepare(
            `UPDATE orchestration_workflow_checkpoints
             SET output_json = json_set(output_json, '$.materialization.leaseExpiresAt', ?),
                 updated_at = ?
             WHERE workflow_run_id = ? AND step_id = ? AND status = 'waiting'
               AND json_extract(output_json, '$.materialization.leaseOwner') = ?`,
          )
          .run(epoch() + 60, epoch(), run.id, step.id, owner)
        if (renewed.changes !== 1) renewalLost = true
      } catch {
        renewalLost = true
      }
    }, 20_000)
    renewal.unref()
    try {
      const result = await this.materializer.materialize({
        workflowRunId: run.id,
        taskId: run.taskId,
        stepId: step.id,
        attemptCount,
        agentDefinition: definition,
      })
      if (renewalLost)
        throw new Error("Workflow materialization claim was lost before snapshot persistence.")
      const parsed = orchestrationAgentDefinitionSchema.parse(result.agentDefinition)
      assertMaterializerIdentity(definition, parsed)
      assertMaterializerMetadata(result)
      const snapshot: WorkflowAgentMaterializationResult = {
        agentDefinition: parsed,
        ...(result.profileSnapshotId ? { profileSnapshotId: result.profileSnapshotId } : {}),
        ...(result.bindingVersion !== undefined ? { bindingVersion: result.bindingVersion } : {}),
      }
      const persisted = db
        .prepare(
          `UPDATE orchestration_workflow_checkpoints
           SET status = 'pending', output_json = ?, error = NULL, updated_at = ?
           WHERE workflow_run_id = ? AND step_id = ? AND status = 'waiting'
             AND json_extract(output_json, '$.materialization.leaseOwner') = ?`,
        )
        .run(
          JSON.stringify({ materialization: { state: "materialized", attemptCount, ...snapshot } }),
          epoch(),
          run.id,
          step.id,
          owner,
        )
      if (persisted.changes !== 1)
        throw new Error("Workflow materialization claim was lost before snapshot persistence.")
      return snapshot
    } catch (error) {
      db.prepare(
        `UPDATE orchestration_workflow_checkpoints
         SET status = 'blocked', output_json = NULL, error = ?, updated_at = ?
         WHERE workflow_run_id = ? AND step_id = ? AND status = 'waiting'
           AND json_extract(output_json, '$.materialization.leaseOwner') = ?`,
      ).run(safeError(error), epoch(), run.id, step.id, owner)
      return null
    } finally {
      clearInterval(renewal)
    }
  }

  private recoverMaterializationClaims(db: Database.Database, run: WorkflowRunDto) {
    db.prepare(
      `UPDATE orchestration_workflow_checkpoints
       SET status = 'pending', updated_at = ?
       WHERE workflow_run_id = ? AND status = 'waiting'
         AND json_extract(output_json, '$.materialization.state') = 'materializing'
         AND json_extract(output_json, '$.materialization.leaseExpiresAt') <= ?`,
    ).run(epoch(), run.id, epoch())
  }

  private async applyRuntimeReference(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    checkpoint: WorkflowRunDto["checkpoints"][number],
    reference: RuntimeLaunchReference,
  ) {
    const persisted = asRecord(checkpoint.output) ?? {}
    const output = {
      ...persisted,
      lifecycle: reference.lifecycleState,
      activityReference: reference.activityReference,
    }
    if (reference.lifecycleState === "completed" && step.outputSchema !== null) {
      try {
        const structured = await this.coordinator.readStructuredOutput?.(reference.runId)
        if (!structured)
          throw new Error("Completed Runtime produced no structured output activity reference.")
        assertOutput(step, structured.value)
        this.setCheckpoint(
          db,
          run,
          step,
          "completed",
          {
            ...output,
            structuredOutput: structured.value,
            structuredOutputReference: structured.activityReference,
          },
          null,
          checkpoint.attemptCount,
        )
      } catch (error) {
        const retryable = checkpoint.attemptCount <= step.maxRetries
        this.setCheckpoint(
          db,
          run,
          step,
          retryable ? "waiting" : "failed",
          output,
          safeError(error),
          checkpoint.attemptCount,
        )
      }
      return
    }
    const status = checkpointStatus(reference.lifecycleState)
    const retryableFailure = status === "failed" && checkpoint.attemptCount <= step.maxRetries
    this.setCheckpoint(
      db,
      run,
      step,
      retryableFailure ? "waiting" : status,
      output,
      retryableFailure
        ? "Runtime failed; explicit retry with a new durable run identity is required."
        : reference.lifecycleState === "cancelled"
          ? "Runtime was cancelled."
          : null,
      checkpoint.attemptCount,
    )
  }

  private evaluateControlStep(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    checkpoints: Map<string, WorkflowRunDto["checkpoints"][number]>,
  ) {
    if (step.kind === "human-gate") {
      this.setCheckpoint(db, run, step, "waiting", null, "Human approval required.", 0)
      return
    }
    if (step.kind === "loop") {
      this.setCheckpoint(db, run, step, "waiting", { iteration: 0 }, null, 0)
      return
    }
    if (step.kind === "branch") {
      if (!step.condition) {
        this.setCheckpoint(db, run, step, "blocked", null, "Branch condition is missing.", 0)
        return
      }
      const source = checkpoints.get(step.condition.stepId)
      if (!source || source.status !== "completed") return
      const actual = readPath(source.output, step.condition.path)
      const conditionMatched = deepEqual(actual, step.condition.equals)
      const selectedStepIds = conditionMatched ? step.thenStepIds : step.elseStepIds
      const skippedStepIds = conditionMatched ? step.elseStepIds : step.thenStepIds
      for (const skippedStepId of skippedStepIds) {
        const skippedStep = requireStep(run, skippedStepId)
        const skipped = checkpoints.get(skippedStepId)
        if (skipped?.status === "pending")
          this.setCheckpoint(db, run, skippedStep, "skipped", { branchStepId: step.id }, null, 0)
      }
      const output = { selectedStepIds, skippedStepIds, conditionMatched }
      assertOutput(step, output)
      this.setCheckpoint(db, run, step, "completed", output, null, 0)
      return
    }
    const children = (step.childStepIds.length ? step.childStepIds : step.dependsOn).map((id) =>
      checkpoints.get(id),
    )
    if (children.length === 0) {
      this.setCheckpoint(
        db,
        run,
        step,
        "blocked",
        null,
        `${step.kind} requires explicit childStepIds or dependencies.`,
        0,
      )
      return
    }
    if (
      children.some((child) => child && ["failed", "blocked", "uncertain"].includes(child.status))
    ) {
      this.setCheckpoint(db, run, step, "failed", null, `${step.kind} child failed closed.`, 0)
      return
    }
    if (!children.every((child) => child && terminalSuccess(child.status))) return
    const output = { childStepIds: children.map((child) => child!.stepId), completed: true }
    assertOutput(step, output)
    this.setCheckpoint(db, run, step, "completed", output, null, 0)
  }

  private evaluateReadyControlSteps(db: Database.Database, runId: string) {
    for (let pass = 0; pass < 512; pass += 1) {
      const run = this.get(runId)
      const checkpoints = new Map(
        run.checkpoints.map((checkpoint) => [checkpoint.stepId, checkpoint]),
      )
      let changed = false
      for (const step of run.definition.workflow.steps) {
        if (["agent", "synthesis"].includes(step.kind)) continue
        const checkpoint = checkpoints.get(step.id)!
        if (checkpoint.status !== "pending") continue
        if (!step.dependsOn.every((id) => terminalSuccess(checkpoints.get(id)?.status))) continue
        this.evaluateControlStep(db, run, step, checkpoints)
        const updated = this.get(runId).checkpoints.find((item) => item.stepId === step.id)
        if (updated?.status !== "pending") changed = true
        for (const item of this.get(runId).checkpoints) checkpoints.set(item.stepId, item)
      }
      if (!changed) return
    }
    throw new Error("Workflow control evaluation exceeded its deterministic pass bound.")
  }

  private withinLaunchLimits(
    db: Database.Database,
    run: WorkflowRunDto,
    checkpoints: Map<string, WorkflowRunDto["checkpoints"][number]>,
    scheduledWorkers = 0,
  ) {
    if (!run.definition.policy.allowSpawn) return false
    const active = [...checkpoints.values()].filter((item) => item.status === "running").length
    const started = [...checkpoints.values()].filter((item) => item.attemptCount > 0).length
    if (active + scheduledWorkers >= run.definition.policy.maxParallelAgents) return false
    const usage = db
      .prepare(
        `SELECT count(*) agents, coalesce(sum(total_tokens), 0) tokens,
                coalesce(sum(CASE WHEN cost_usd_micros IS NOT NULL THEN cost_usd_micros ELSE 0 END), 0) cost
         FROM orchestration_agents WHERE task_id = ?`,
      )
      .get(run.taskId) as { agents: number; tokens: number; cost: number }
    if (
      Math.max(started + scheduledWorkers, Number(usage.agents)) >=
      run.definition.policy.maxTotalAgents
    )
      return false
    if (
      run.definition.policy.maxTotalTokens !== null &&
      Number(usage.tokens) >= run.definition.policy.maxTotalTokens
    )
      return false
    if (
      run.definition.policy.maxCostUsdMicros !== null &&
      Number(usage.cost) >= run.definition.policy.maxCostUsdMicros
    )
      return false
    return true
  }

  private setCheckpoint(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    status: CheckpointStatus,
    output: unknown,
    error: string | null,
    attemptCount: number,
  ) {
    db.prepare(
      `UPDATE orchestration_workflow_checkpoints
       SET status = ?, output_json = ?, error = ?, attempt_count = ?, updated_at = ?
       WHERE workflow_run_id = ? AND step_id = ?`,
    ).run(
      status,
      output === null ? null : JSON.stringify(output),
      error ? safeError(error) : null,
      attemptCount,
      epoch(),
      run.id,
      step.id,
    )
    this.recordCheckpoint(db, run, step, status, attemptCount, asRecord(output)?.runId as string)
  }

  private recordCheckpoint(
    db: Database.Database,
    run: WorkflowRunDto,
    step: Step,
    status: CheckpointStatus,
    attemptCount: number,
    runId?: string,
  ) {
    recordOrchestrationTransition(db, {
      dedupKey: `checkpoint:${run.id}:${step.id}:${status}:${attemptCount}:${epoch()}`,
      taskId: run.taskId,
      entityType: "checkpoint",
      entityId: `${run.id}:${step.id}`,
      runId: runId ?? null,
      kind: "checkpoint",
      phase: status,
    })
  }

  private refreshRunStatus(db: Database.Database, run: WorkflowRunDto) {
    const control = db
      .prepare("SELECT status, stop_intent FROM orchestration_workflow_runs WHERE id = ?")
      .get(run.id) as { status: string; stop_intent: number }
    if (control.stop_intent) {
      this.setRunStatus(db, this.get(run.id), "stopped")
      return
    }
    if (control.status === "paused" || control.status === "stopped") return
    const statuses = run.checkpoints.map((item) => item.status)
    const status: WorkflowRunDto["status"] = statuses.some((value) => value === "uncertain")
      ? "uncertain"
      : statuses.some((value) => value === "blocked")
        ? "blocked"
        : statuses.some((value) => value === "failed")
          ? "failed"
          : statuses.some((value) => value === "running")
            ? "running"
            : statuses.some((value) => value === "waiting")
              ? "waiting"
              : statuses.every(terminalSuccess)
                ? "completed"
                : "running"
    this.setRunStatus(db, run, status)
  }

  private setRunStatus(
    db: Database.Database,
    run: WorkflowRunDto,
    status: WorkflowRunDto["status"],
    allowedCurrent?: WorkflowRunDto["status"][],
  ) {
    if (run.status === status) return
    const params: unknown[] = [status, epoch(), run.id]
    let where = "id = ?"
    if (allowedCurrent) {
      where += ` AND status IN (${allowedCurrent.map(() => "?").join(",")})`
      params.push(...allowedCurrent)
    }
    const result = db
      .prepare(`UPDATE orchestration_workflow_runs SET status = ?, updated_at = ? WHERE ${where}`)
      .run(...params)
    if (result.changes === 1)
      recordOrchestrationTransition(db, {
        dedupKey: `workflow:${run.id}:${status}:${epoch()}`,
        taskId: run.taskId,
        entityType: "workflow",
        entityId: run.id,
        kind: "workflow-phase",
        phase: status,
      })
  }
}

function validateWorkflow(steps: Step[]): void {
  const ids = new Set(steps.map((step) => step.id))
  if (ids.size !== steps.length) throw new Error("Workflow step IDs must be unique.")
  const byId = new Map(steps.map((step) => [step.id, step]))
  for (const step of steps) {
    for (const dependency of [
      ...step.dependsOn,
      ...step.childStepIds,
      ...step.thenStepIds,
      ...step.elseStepIds,
      ...step.bodyStepIds,
      ...(step.condition ? [step.condition.stepId] : []),
    ])
      if (!ids.has(dependency)) throw new Error(`Unknown workflow step ${dependency}.`)
    if (step.kind === "branch" && !step.condition)
      throw new Error(`Branch ${step.id} requires a condition.`)
    if (step.kind === "branch") {
      for (const memberId of [...step.thenStepIds, ...step.elseStepIds])
        if (!byId.get(memberId)!.dependsOn.includes(step.id))
          throw new Error(`Branch ${step.id} members must depend on the branch gate.`)
    }
    if (step.kind === "loop" && step.bodyStepIds.length === 0)
      throw new Error(`Loop ${step.id} requires bodyStepIds.`)
    if (step.kind === "loop") {
      for (const memberId of step.bodyStepIds)
        if (!byId.get(memberId)!.dependsOn.includes(step.id))
          throw new Error(`Loop ${step.id} body members must depend on the loop gate.`)
    }
    if (step.kind === "pipeline") {
      for (let index = 1; index < step.childStepIds.length; index++) {
        const current = byId.get(step.childStepIds[index]!)!
        if (!current.dependsOn.includes(step.childStepIds[index - 1]!))
          throw new Error(`Pipeline ${step.id} children must declare ordered dependencies.`)
      }
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Workflow dependencies contain a cycle.")
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const step of steps) visit(step.id)
}

function assertOutput(step: Step, output: unknown) {
  if (step.outputSchema === null) return
  validateJsonSchema(step.outputSchema, output, `Step ${step.id} output`)
}
function validateJsonSchema(schema: Record<string, unknown>, value: unknown, path: string): void {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value)))
    throw new Error(`${path} is not an allowed enum value.`)
  if ("const" in schema && !deepEqual(schema.const, value))
    throw new Error(`${path} does not match the required constant.`)
  const type = typeof schema.type === "string" ? schema.type : null
  const matchesType =
    type === null ||
    (type === "null" && value === null) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "object" && asRecord(value) !== null) ||
    (type === "string" && typeof value === "string") ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "integer" && typeof value === "number" && Number.isInteger(value))
  if (!matchesType) throw new Error(`${path} must match JSON Schema type ${type}.`)
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      throw new Error(`${path} is shorter than minLength.`)
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      throw new Error(`${path} exceeds maxLength.`)
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new Error(`${path} is below minimum.`)
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new Error(`${path} exceeds maximum.`)
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      throw new Error(`${path} has fewer than minItems.`)
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      throw new Error(`${path} exceeds maxItems.`)
    const itemSchema = asRecord(schema.items)
    if (itemSchema)
      value.forEach((item, index) => validateJsonSchema(itemSchema, item, `${path}[${index}]`))
  }
  const record = asRecord(value)
  if (!record) return
  if (Array.isArray(schema.required))
    for (const key of schema.required)
      if (typeof key === "string" && !(key in record))
        throw new Error(`${path} is missing required field ${key}.`)
  const properties = asRecord(schema.properties) ?? {}
  for (const [key, childSchema] of Object.entries(properties)) {
    const parsed = asRecord(childSchema)
    if (parsed && key in record) validateJsonSchema(parsed, record[key], `${path}.${key}`)
  }
  if (schema.additionalProperties === false)
    for (const key of Object.keys(record))
      if (!(key in properties)) throw new Error(`${path} contains unknown field ${key}.`)
}
function requireStep(run: WorkflowRunDto, stepId: string, kind?: Step["kind"]) {
  const step = run.definition.workflow.steps.find((item) => item.id === stepId)
  if (!step || (kind && step.kind !== kind))
    throw new Error("Workflow step does not match request.")
  return step
}
function requireCheckpoint(run: WorkflowRunDto, stepId: string) {
  const checkpoint = run.checkpoints.find((item) => item.stepId === stepId)
  if (!checkpoint) throw new Error("Workflow checkpoint not found.")
  return checkpoint
}
function terminalSuccess(status: string | undefined) {
  return status === "completed" || status === "skipped"
}
function readPath(value: unknown, path: string[]) {
  let current: unknown = value
  for (const key of path) current = asRecord(current)?.[key]
  return current
}
function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
function materializationSnapshot(value: unknown): WorkflowAgentMaterializationResult | null {
  const materialization = asRecord(asRecord(value)?.materialization)
  if (materialization?.state !== "materialized") return null
  const agentDefinition = orchestrationAgentDefinitionSchema.parse(materialization.agentDefinition)
  return {
    agentDefinition,
    ...(typeof materialization.profileSnapshotId === "string"
      ? { profileSnapshotId: materialization.profileSnapshotId }
      : {}),
    ...(typeof materialization.bindingVersion === "number"
      ? { bindingVersion: materialization.bindingVersion }
      : {}),
  }
}
function assertMaterializerIdentity(
  requested: OrchestrationAgentDefinition,
  returned: OrchestrationAgentDefinition,
) {
  if (
    requested.agentId !== returned.agentId ||
    requested.definitionId !== returned.definitionId ||
    !deepEqual(requested.dependencyAgentIds, returned.dependencyAgentIds)
  )
    throw new Error("Worker materializer changed immutable definition identity or topology.")
}
function assertMaterializerMetadata(result: WorkflowAgentMaterializationResult) {
  if (
    result.profileSnapshotId !== undefined &&
    (!result.profileSnapshotId.trim() || result.profileSnapshotId.length > 512)
  )
    throw new Error("Worker materializer returned an invalid profile snapshot identity.")
  if (
    result.bindingVersion !== undefined &&
    (!Number.isSafeInteger(result.bindingVersion) || result.bindingVersion < 0)
  )
    throw new Error("Worker materializer returned an invalid binding version.")
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function assertReferenceMatches(
  request: Omit<WorkflowWorkerLaunch, "stepId">,
  reference: RuntimeLaunchReference,
) {
  if (
    reference.runId !== request.runId ||
    reference.chatId !== request.chatId ||
    reference.subChatId !== request.subChatId
  )
    throw new Error("Runtime launch reference identity mismatch.")
}
function checkpointStatus(
  lifecycle: RuntimeLaunchReference["lifecycleState"],
): "running" | "completed" | "failed" | "uncertain" {
  if (lifecycle === "completed") return "completed"
  if (lifecycle === "cancelled") return "failed"
  if (lifecycle === "failed") return "failed"
  if (lifecycle === "uncertain") return "uncertain"
  return "running"
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500)
}
function epoch() {
  return Math.floor(Date.now() / 1000)
}
