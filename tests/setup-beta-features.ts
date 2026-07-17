import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BETA_FEATURE_IDS, type BetaFeatureSettings } from "../src/shared/beta-features"

const directory = mkdtempSync(join(tmpdir(), "flapstack-test-features-"))
const settings = Object.fromEntries(BETA_FEATURE_IDS.map((id) => [id, true])) as BetaFeatureSettings

mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, "beta-features.json"), JSON.stringify(settings))
process.env.FLAPSTACK_CONFIG_DIR = directory
