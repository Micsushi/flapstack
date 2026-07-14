import {
  probeCursorCapabilities,
  probeOpencodeCapabilities,
} from "../../harness/provider-capabilities"
import { publicProcedure, router } from "../index"

export const providerCapabilitiesRouter = router({
  probe: publicProcedure.query(async () => {
    const [cursor, opencode] = await Promise.all([
      probeCursorCapabilities(),
      probeOpencodeCapabilities(),
    ])
    return { cursor, opencode }
  }),
})
