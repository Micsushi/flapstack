import { randomUUID } from "node:crypto"
import { and, asc, eq, gt, isNull, or } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  mobileAuthorityGrantSchema,
  type MobileAuthorityGrant,
} from "../../../shared/mobile-control"
import type { MobileDeviceConnectionTerminator } from "../mobile-pairing"
import * as schema from "../db/schema"
import {
  mobileAuthorityGrants,
  mobileDeviceSessions,
  mobileDevices,
  mobileEventStreams,
} from "../db/schema"

export type MobileGrantInput = Pick<
  MobileAuthorityGrant,
  "authority" | "capabilities" | "resources"
> & { expiresAt?: number }

export class MobileGrantError extends Error {
  constructor(
    readonly code: "device-invalid" | "grant-invalid" | "stale-scope",
    message: string,
  ) {
    super(message)
    this.name = "MobileGrantError"
  }
}

type Database = BetterSQLite3Database<typeof schema>
type GrantRow = typeof mobileAuthorityGrants.$inferSelect

export class MobileScopeGrantService {
  private readonly now: () => number
  private readonly randomId: () => string

  constructor(
    private readonly options: {
      database: Database
      connections: MobileDeviceConnectionTerminator
      now?: () => number
      randomId?: () => string
    },
  ) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
  }

  async createGrant(deviceId: string, input: MobileGrantInput): Promise<MobileAuthorityGrant> {
    return this.writeGrant(deviceId, input)
  }

  async replaceGrant(grantId: string, input: MobileGrantInput): Promise<MobileAuthorityGrant> {
    const current = this.options.database
      .select()
      .from(mobileAuthorityGrants)
      .where(eq(mobileAuthorityGrants.id, grantId))
      .get()
    if (!current || current.revokedAt)
      throw new MobileGrantError("grant-invalid", "Mobile authority grant is missing or revoked.")
    return this.writeGrant(current.deviceId, input, grantId)
  }

  async revokeGrant(grantId: string): Promise<void> {
    const now = this.now()
    const row = this.options.database
      .select()
      .from(mobileAuthorityGrants)
      .where(eq(mobileAuthorityGrants.id, grantId))
      .get()
    if (!row) throw new MobileGrantError("grant-invalid", "Mobile authority grant was not found.")
    if (row.revokedAt) return

    this.options.database.transaction((tx) => {
      const device = tx.select().from(mobileDevices).where(eq(mobileDevices.id, row.deviceId)).get()
      assertDevice(device)
      const nextScopeVersion = device!.scopeVersion + 1
      tx.update(mobileAuthorityGrants)
        .set({ revokedAt: toDate(now) })
        .where(and(eq(mobileAuthorityGrants.id, grantId), isNull(mobileAuthorityGrants.revokedAt)))
        .run()
      advanceDeviceScope(tx, row.deviceId, nextScopeVersion)
    })
    await this.options.connections.terminateDevice(row.deviceId, "authorization-changed")
  }

  listActiveGrants(deviceId?: string): MobileAuthorityGrant[] {
    const now = toDate(this.now())
    return this.options.database
      .select()
      .from(mobileAuthorityGrants)
      .where(
        and(
          isNull(mobileAuthorityGrants.revokedAt),
          or(isNull(mobileAuthorityGrants.expiresAt), gt(mobileAuthorityGrants.expiresAt, now)),
          deviceId ? eq(mobileAuthorityGrants.deviceId, deviceId) : undefined,
        ),
      )
      .orderBy(asc(mobileAuthorityGrants.issuedAt), asc(mobileAuthorityGrants.id))
      .all()
      .map(grantFromRow)
  }

  requireActiveGrant(
    grantId: string,
    deviceId: string,
    scopeVersion?: number,
  ): MobileAuthorityGrant {
    const row = this.options.database
      .select()
      .from(mobileAuthorityGrants)
      .where(eq(mobileAuthorityGrants.id, grantId))
      .get()
    const now = this.now()
    if (
      !row ||
      row.deviceId !== deviceId ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt.getTime() <= now)
    )
      throw new MobileGrantError("grant-invalid", "Mobile authority grant is unavailable.")
    const grant = grantFromRow(row)
    if (scopeVersion !== undefined && grant.scopeVersion !== scopeVersion)
      throw new MobileGrantError("stale-scope", "Mobile authority scope changed.")
    return grant
  }

  private async writeGrant(
    deviceId: string,
    input: MobileGrantInput,
    replacedGrantId?: string,
  ): Promise<MobileAuthorityGrant> {
    const now = this.now()
    const grantId = this.randomId()
    const created = this.options.database.transaction((tx) => {
      const device = tx.select().from(mobileDevices).where(eq(mobileDevices.id, deviceId)).get()
      assertDevice(device)
      const nextScopeVersion = device!.scopeVersion + 1
      const parsed = mobileAuthorityGrantSchema.parse({
        grantId,
        deviceId,
        authority: input.authority,
        capabilities: input.capabilities,
        resources: input.resources,
        issuedAt: now,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        scopeVersion: nextScopeVersion,
      })
      if (replacedGrantId) {
        const changed = tx
          .update(mobileAuthorityGrants)
          .set({ revokedAt: toDate(now) })
          .where(
            and(
              eq(mobileAuthorityGrants.id, replacedGrantId),
              eq(mobileAuthorityGrants.deviceId, deviceId),
              isNull(mobileAuthorityGrants.revokedAt),
            ),
          )
          .returning({ id: mobileAuthorityGrants.id })
          .get()
        if (!changed)
          throw new MobileGrantError("grant-invalid", "Grant changed before replacement.")
      }
      tx.update(mobileAuthorityGrants)
        .set({ scopeVersion: nextScopeVersion })
        .where(
          and(
            eq(mobileAuthorityGrants.deviceId, deviceId),
            isNull(mobileAuthorityGrants.revokedAt),
          ),
        )
        .run()
      tx.insert(mobileAuthorityGrants)
        .values({
          id: parsed.grantId,
          deviceId: parsed.deviceId,
          authority: JSON.stringify(parsed.authority),
          capabilities: JSON.stringify(parsed.capabilities),
          resources: JSON.stringify(parsed.resources),
          issuedAt: toDate(parsed.issuedAt),
          expiresAt: parsed.expiresAt === undefined ? null : toDate(parsed.expiresAt),
          scopeVersion: parsed.scopeVersion,
        })
        .run()
      tx.insert(mobileEventStreams)
        .values({ grantId, lastSequence: 0, updatedAt: toDate(now) })
        .run()
      advanceDeviceScope(tx, deviceId, nextScopeVersion)
      return parsed
    })
    await this.options.connections.terminateDevice(deviceId, "authorization-changed")
    return created
  }
}

function advanceDeviceScope(database: Database, deviceId: string, scopeVersion: number): void {
  database
    .update(mobileDevices)
    .set({ scopeVersion })
    .where(and(eq(mobileDevices.id, deviceId), isNull(mobileDevices.revokedAt)))
    .run()
  database
    .update(mobileDeviceSessions)
    .set({ scopeVersion })
    .where(and(eq(mobileDeviceSessions.deviceId, deviceId), isNull(mobileDeviceSessions.revokedAt)))
    .run()
  database
    .update(mobileAuthorityGrants)
    .set({ scopeVersion })
    .where(
      and(eq(mobileAuthorityGrants.deviceId, deviceId), isNull(mobileAuthorityGrants.revokedAt)),
    )
    .run()
}

function assertDevice(device: typeof mobileDevices.$inferSelect | undefined): void {
  if (!device || device.revokedAt)
    throw new MobileGrantError("device-invalid", "Mobile device is missing or revoked.")
  if (device.scopeVersion >= Number.MAX_SAFE_INTEGER)
    throw new MobileGrantError("stale-scope", "Mobile scope version cannot advance safely.")
}

export function grantFromRow(row: GrantRow): MobileAuthorityGrant {
  try {
    return mobileAuthorityGrantSchema.parse({
      grantId: row.id,
      deviceId: row.deviceId,
      authority: JSON.parse(row.authority),
      capabilities: JSON.parse(row.capabilities),
      resources: JSON.parse(row.resources),
      issuedAt: row.issuedAt.getTime(),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.getTime() } : {}),
      ...(row.revokedAt ? { revokedAt: row.revokedAt.getTime() } : {}),
      scopeVersion: row.scopeVersion,
    })
  } catch {
    throw new MobileGrantError("grant-invalid", "Stored mobile authority grant is invalid.")
  }
}

function toDate(milliseconds: number): Date {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000)
}
