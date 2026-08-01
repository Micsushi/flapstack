import { z } from "zod"
import {
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceDataset,
  type PerformanceDatasetDefinition,
} from "./budgets"
import { canonicalJson, sha256Bytes } from "./canonical"

export const PERFORMANCE_FIXTURE_GENERATOR_VERSION = "stage6-fixture-v1" as const

export const performanceFixtureManifestSchema = z
  .object({
    id: z.string().regex(/^stage6-(small|medium|large|stress)-v[1-9]\d{0,5}$/),
    dataset: z.enum(["small", "medium", "large", "stress"]),
    version: z.string().regex(/^[1-9]\d{0,5}$/),
    generatorVersion: z.literal(PERFORMANCE_FIXTURE_GENERATOR_VERSION),
    seed: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cardinality: z.record(z.string(), z.number().int().nonnegative()).refine((value) => {
      const count = Object.keys(value).length
      return count > 0 && count <= 32
    }),
    byteLength: z.number().int().positive().max(1_000_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export type PerformanceFixtureManifest = z.infer<typeof performanceFixtureManifestSchema>

export interface AuthoritativePerformanceFixture {
  manifest: PerformanceFixtureManifest
  bytes: Buffer
}

export function createPerformanceFixture(
  datasetId: PerformanceDataset,
): AuthoritativePerformanceFixture {
  const definition = datasetDefinition(datasetId)
  const bytes = Buffer.from(
    canonicalJson({
      schemaVersion: 1,
      generatorVersion: PERFORMANCE_FIXTURE_GENERATOR_VERSION,
      dataset: definition.id,
      version: definition.version,
      seed: definition.seed,
      cardinality: definition.cardinality,
    }),
    "utf8",
  )
  return {
    manifest: {
      id: `stage6-${definition.id}-v${definition.version}`,
      dataset: definition.id,
      version: definition.version,
      generatorVersion: PERFORMANCE_FIXTURE_GENERATOR_VERSION,
      seed: definition.seed,
      cardinality: { ...definition.cardinality },
      byteLength: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    },
    bytes,
  }
}

export function verifyPerformanceFixture(
  manifestInput: PerformanceFixtureManifest,
  bytes: Buffer,
): PerformanceFixtureManifest {
  const manifest = performanceFixtureManifestSchema.parse(manifestInput)
  const expected = createPerformanceFixture(manifest.dataset)
  if (manifest.byteLength !== bytes.byteLength) {
    throw new Error("Performance fixture bytes do not match the declared length.")
  }
  if (sha256Bytes(bytes) !== manifest.sha256) {
    throw new Error("Performance fixture digest does not match the supplied bytes.")
  }
  if (canonicalJson(manifest) !== canonicalJson(expected.manifest)) {
    throw new Error("Performance fixture manifest does not match dataset authority.")
  }
  if (!bytes.equals(expected.bytes)) {
    throw new Error("Performance fixture bytes do not match dataset authority.")
  }
  return expected.manifest
}

function datasetDefinition(datasetId: PerformanceDataset): PerformanceDatasetDefinition {
  const definition = STAGE6_PERFORMANCE_BUDGETS.datasets.find((dataset) => dataset.id === datasetId)
  if (!definition) throw new Error(`Unknown performance dataset: ${datasetId}`)
  return definition
}
