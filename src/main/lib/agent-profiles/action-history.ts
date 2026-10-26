import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { Mutex } from "async-mutex"
import { AgentProfileService } from "./service"
import { AgentPersonalityStore } from "./personality-store"
import { classifyAgentProfileCapabilityChange } from "./capability-change"
import { canonicalJson, sha256Text } from "./values"
import type { AgentPersonalityMetadata } from "../../../shared/agent-personalities"

type Direction = "undo" | "redo"
type Port<T> = {
  key: string
  atomic: <R>(operation: () => R) => R
  read: () => T
  content: (state: T) => unknown
  restore: (current: T, target: T) => void
}
type Chain = { stamp: string }
type Receipt = {
  owner: string
  key: string
  chain: Chain
  bytes: number
  apply: (direction: Direction, sequence: number) => { sequence: number; direction: Direction }
}
const stamp = (value: unknown) => sha256Text(canonicalJson(value))

// Receipts retain only local state; immutable versions and historical references are never rewound.
export class ProfileActionHistory {
  private readonly mutex = new Mutex()
  private readonly receipts = new Map<string, Receipt>()
  private readonly chains = new Map<string, Chain>()

  async change<T, R extends object>(
    owner: string,
    port: Port<T>,
    write: (before: T) => R,
    reversible: (before: T, after: T) => boolean = () => true,
  ) {
    return this.mutex.runExclusive(() => {
      const { before, after, result } = port.atomic(() => {
        const before = port.read()
        const result = write(before)
        return { before, result, after: port.read() }
      })
      const bytes =
        Buffer.byteLength(canonicalJson(before)) + Buffer.byteLength(canonicalJson(after))
      if (!reversible(before, after) || bytes > 1024 * 1024) {
        this.chains.delete(port.key)
        return {
          ...result,
          history: null,
          historyUnavailable:
            "Saved. Undo is unavailable for authority changes or oversized edits; save a new version to change them.",
        }
      }
      const known = this.chains.get(port.key)
      const chain = known?.stamp === stamp(before) ? known : { stamp: stamp(before) }
      chain.stamp = stamp(after)
      this.chains.set(port.key, chain)
      let next: Direction = "undo"
      let committed: { sequence: number; direction: Direction } | null = null
      const actionId = randomUUID()
      this.receipts.set(actionId, {
        owner,
        key: port.key,
        chain,
        bytes,
        apply: (direction, sequence) => {
          // Only the most recent committed request can be acknowledged without writing again.
          if (committed?.sequence === sequence && committed.direction === direction)
            return committed
          if (!Number.isSafeInteger(sequence) || sequence !== (committed?.sequence ?? 0) + 1)
            throw new Error("This profile history request is stale or out of order.")
          if (direction !== next)
            throw new Error("This profile action is not ready for that history direction.")
          const expected = direction === "undo" ? after : before
          const target = direction === "undo" ? before : after
          const restored = port.atomic(() => {
            const current = port.read()
            if (
              this.chains.get(port.key) !== chain ||
              stamp(current) !== chain.stamp ||
              canonicalJson(port.content(current)) !== canonicalJson(port.content(expected))
            ) {
              throw new Error(
                "Profile state changed outside this history. Newer changes were kept.",
              )
            }
            port.restore(current, target)
            return port.read()
          })
          chain.stamp = stamp(restored)
          next = direction === "undo" ? "redo" : "undo"
          committed = { sequence, direction }
          return committed
        },
      })
      let total = [...this.receipts.values()].reduce((sum, receipt) => sum + receipt.bytes, 0)
      while (this.receipts.size > 100 || total > 8 * 1024 * 1024) {
        const oldest = this.receipts.keys().next().value!
        total -= this.receipts.get(oldest)!.bytes
        this.receipts.delete(oldest)
      }
      for (const key of this.chains.keys()) {
        if (![...this.receipts.values()].some((receipt) => receipt.key === key))
          this.chains.delete(key)
      }
      return { ...result, history: { actionId }, historyUnavailable: null }
    })
  }

  async apply(owner: string, actionId: string, direction: Direction, sequence: number) {
    return this.mutex.runExclusive(() => {
      const receipt = this.receipts.get(actionId)
      if (!receipt || receipt.owner !== owner)
        throw new Error("This profile undo is no longer available in this app session.")
      const acknowledgment = receipt.apply(direction, sequence)
      return { success: true as const, ...acknowledgment }
    })
  }
}

export const profileActionHistory = new ProfileActionHistory()

export function profileHistoryPort(
  database: { $client: Database.Database },
  owner: string,
  profileId: string,
  kind: "edit" | "archive" = "edit",
) {
  const service = new AgentProfileService(database)
  const read = () => {
    const identity = service.get({ profileId, version: 1 }).profile
    return service.get({ profileId, version: identity.currentVersion })
  }
  return {
    service,
    key: `${owner}:${profileId}`,
    atomic: <R>(operation: () => R) => database.$client.transaction(operation).immediate(),
    read,
    content: (state: ReturnType<typeof read>) => ({
      name: state.profile.name,
      description: state.profile.description,
      category: state.profile.category,
      scope: state.profile.scope,
      archived: state.profile.archivedAt !== null,
      definition: state.version.definition,
    }),
    restore: (current: ReturnType<typeof read>, target: ReturnType<typeof read>) => {
      if (kind === "archive") {
        service.archive(
          { profileId, expectedVersion: current.profile.currentVersion },
          target.profile.archivedAt === null,
          target.profile.archivedAt ?? undefined,
        )
      } else {
        service.update({
          profileId,
          expectedVersion: current.profile.currentVersion,
          identity: {
            name: target.profile.name,
            description: target.profile.description,
            category: target.profile.category,
          },
          definition: target.version.definition,
        })
      }
    },
  }
}

export function reversibleProfileEdit(
  before: ReturnType<ReturnType<typeof profileHistoryPort>["read"]>,
  after: ReturnType<ReturnType<typeof profileHistoryPort>["read"]>,
) {
  return (
    classifyAgentProfileCapabilityChange(before.version.definition, after.version.definition)
      .kind === "presentation-only" &&
    classifyAgentProfileCapabilityChange(after.version.definition, before.version.definition)
      .kind === "presentation-only"
  )
}

export function personalityHistoryPort(
  store: AgentPersonalityStore,
  owner: string,
  personalityId: string,
  scope: AgentPersonalityMetadata["scope"],
  kind: "edit" | "archive" = "edit",
) {
  const root = store.rootFor(scope)
  const read = () => {
    if (store.rootFor(scope) !== root)
      throw new Error("Personality storage moved. Reload before using history.")
    return store.historyState(personalityId, scope)
  }
  return {
    key: `${owner}:${root}:${personalityId}`,
    atomic: <R>(operation: () => R) => store.withHistoryLock(personalityId, scope, operation),
    read,
    content: (state: ReturnType<typeof read>) => ({
      ...state.document.metadata,
      version: undefined,
      body: state.document.body,
      archived: state.manifest.archivedAt !== null,
    }),
    restore: (current: ReturnType<typeof read>, target: ReturnType<typeof read>) => {
      const identity = { personalityId, scope, expectedVersion: current.manifest.currentVersion }
      if (kind === "archive") {
        if (target.manifest.archivedAt === null) store.restore(identity)
        else store.archive(identity, target.manifest.archivedAt)
      } else {
        store.update({
          ...identity,
          name: target.document.metadata.name,
          base: target.document.metadata.base,
          traits: target.document.metadata.traits,
          body: target.document.body,
        })
      }
    },
  }
}
