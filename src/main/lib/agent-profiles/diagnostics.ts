import Database from "better-sqlite3"
import { STARTER_AGENT_PROFILES } from "./starter-catalog"

type DatabaseLike = Database.Database | object

export function getAgentProfileDiagnostics(database: DatabaseLike) {
  const sqlite = rawClient(database)
  const count = (sql: string, ...params: unknown[]) =>
    Number((sqlite.prepare(sql).get(...params) as { count: number }).count)
  const pendingImports = sqlite
    .prepare(
      `SELECT id, digest, source_label sourceLabel, created_at createdAt, expires_at expiresAt
       FROM agent_profile_import_previews WHERE confirmed_at IS NULL AND expires_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(epoch())
  const failedEvaluations = sqlite
    .prepare(
      `SELECT profile_id profileId, profile_version profileVersion, runtime, model,
              evidence_digest evidenceDigest, created_at createdAt
       FROM agent_profile_evaluations WHERE state = 'failed'
       ORDER BY created_at DESC LIMIT 50`,
    )
    .all()
  return {
    schemaVersion: 1,
    feature: {
      enabled: true,
      hostedMarketplace: false,
      remoteUpdates: false,
      persistentMemory: false,
    },
    counts: {
      profiles: count("SELECT count(*) count FROM agent_profiles"),
      archived: count("SELECT count(*) count FROM agent_profiles WHERE archived_at IS NOT NULL"),
      versions: count("SELECT count(*) count FROM agent_profile_versions"),
      snapshots: count("SELECT count(*) count FROM agent_profile_snapshots"),
      workflowBindings: count("SELECT count(*) count FROM agent_profile_workflow_bindings"),
      standaloneLaunches: count("SELECT count(*) count FROM agent_profile_standalone_launches"),
      testedLocal: count(
        "SELECT count(*) count FROM agent_profile_evaluations WHERE state = 'tested-local'",
      ),
      supported: count(
        "SELECT count(*) count FROM agent_profile_evaluations WHERE state = 'supported'",
      ),
    },
    starterCatalog: STARTER_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      name: profile.name,
      owner: profile.owner,
      updateNotes: profile.updateNotes,
      supportedCombinations: profile.supportedCombinations,
    })),
    pendingImports,
    failedEvaluations,
    limitations: [
      "Persistent profile memory is disabled.",
      "Hosted/community marketplace and remote profile updates are disabled.",
      "Local contract evaluation does not claim provider/model task quality.",
    ],
  }
}

function rawClient(database: DatabaseLike): Database.Database {
  if ("prepare" in database && typeof database.prepare === "function") {
    return database as Database.Database
  }
  return (database as unknown as { $client: Database.Database }).$client
}

function epoch() {
  return Math.floor(Date.now() / 1_000)
}
