import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { checkRuntimeCompatibility } from "../agent-runtime/compatibility"
import {
  agentCapabilityProfileSchema,
  agentPresentationStyleSchema,
  agentProfileEvaluationInputSchema,
} from "../../../shared/agent-profiles"
import { createAgentProfileService } from "./service"
import { canonicalJson, epochSeconds as epoch, sha256Text as sha256 } from "./values"

type DatabaseLike = Database.Database | object

export class AgentProfileEvaluationService {
  private readonly sqlite: Database.Database

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  run(inputValue: unknown) {
    const input = agentProfileEvaluationInputSchema.parse(inputValue)
    const item = createAgentProfileService(this.sqlite).get(input.profile)
    const capability = item.version.definition.capability
    const presentation = item.version.definition.presentation
    const results = input.fixtures.map((fixture) => {
      switch (fixture) {
        case "schema":
          return result(
            fixture,
            agentCapabilityProfileSchema.safeParse(capability).success &&
              agentPresentationStyleSchema.safeParse(presentation).success,
            "Capability and presentation schemas remain independently valid.",
          )
        case "capability":
          return result(
            fixture,
            capability.memoryPolicy.mode === "none" && capability.maxDescendants <= 64,
            "Persistent memory is disabled and descendant authority is bounded.",
          )
        case "permission":
          return result(
            fixture,
            capability.permissionMode !== "custom" || Boolean(capability.customPermissions),
            "Permission mode is complete and cannot be supplied by presentation fields.",
          )
        case "prompt-injection":
          return result(
            fixture,
            /untrusted/i.test(capability.instructions) &&
              /authority|permissions|safety/i.test(capability.instructions),
            "Instructions explicitly treat external content as untrusted and preserve authority.",
          )
        case "determinism":
          return result(
            fixture,
            !/change|override|ignore/i.test(
              `${presentation.responseStructure} ${presentation.characterLabel ?? ""}`,
            ),
            "Presentation text contains no control-plane override language.",
          )
        case "task-quality":
          return result(
            fixture,
            capability.role.length >= 3 && capability.instructions.length >= 80,
            "Role and instructions meet the deterministic starter quality floor.",
          )
      }
    })
    const runtime = checkRuntimeCompatibility(capability.harness, input.runtime)
    results.push(
      result(
        "runtime-compatibility",
        runtime.compatible,
        runtime.compatible ? "Harness and Runtime are compatible." : runtime.reason.message,
      ),
    )
    const passed = results.every((entry) => entry.passed)
    // Deterministic local fixtures cannot claim provider/model quality. A live
    // evidence importer may promote this append-only record in a later sweep.
    const state = passed ? "tested-local" : "failed"
    const evidence = {
      schemaVersion: 1,
      profile: input.profile,
      runtime: input.runtime,
      model: input.model,
      fixtureSet: input.fixtures,
      results,
      qualityClaim: "local-contract-only",
      passed,
    }
    const evidenceDigest = sha256(canonicalJson(evidence))
    const id = randomUUID()
    this.sqlite
      .prepare(
        `INSERT INTO agent_profile_evaluations
         (id, profile_id, profile_version, runtime, model, state, fixture_set_json,
          evidence_json, evidence_digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.profile.profileId,
        input.profile.version,
        input.runtime,
        input.model,
        state,
        JSON.stringify(input.fixtures),
        JSON.stringify(evidence),
        evidenceDigest,
        epoch(),
      )
    return { id, state, evidenceDigest, evidence }
  }

  history(profileId?: string) {
    return this.sqlite
      .prepare(
        `SELECT id, profile_id profileId, profile_version profileVersion, runtime, model,
                state, evidence_json evidence, evidence_digest evidenceDigest, created_at createdAt
         FROM agent_profile_evaluations ${profileId ? "WHERE profile_id = ?" : ""}
         ORDER BY created_at DESC, id DESC LIMIT 200`,
      )
      .all(...(profileId ? [profileId] : []))
      .map((row) => {
        const value = row as Record<string, unknown>
        return { ...value, evidence: JSON.parse(String(value.evidence)) }
      })
  }
}

function result(fixture: string, passed: boolean, detail: string) {
  return { fixture, passed, detail }
}

function rawClient(database: DatabaseLike): Database.Database {
  if ("prepare" in database && typeof database.prepare === "function") {
    return database as Database.Database
  }
  return (database as unknown as { $client: Database.Database }).$client
}
