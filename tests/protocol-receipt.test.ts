import { beforeEach, describe, expect, it } from "vitest"
import {
  getLastProtocolReceipt,
  protocolUrlFingerprint,
  recordProtocolDispatch,
  recordProtocolReceipt,
  resetProtocolReceiptsForTests,
} from "../src/main/lib/protocol-receipt"

describe("protocol receipt", () => {
  beforeEach(resetProtocolReceiptsForTests)

  it("records secret-safe accepted identity without query values", () => {
    const url = "flapstack-dev://stage5-proof/open?nonce=proof-123&code=never-return-this"
    expect(
      recordProtocolReceipt(url, "flapstack-dev", "second-instance", () => new Date(0)),
    ).toEqual({
      sequence: 1,
      receivedAt: "1970-01-01T00:00:00.000Z",
      source: "second-instance",
      accepted: true,
      protocol: "flapstack-dev",
      host: "stage5-proof",
      pathname: "/open",
      queryKeys: ["code", "nonce"],
      urlFingerprint: protocolUrlFingerprint(url),
      activated: null,
      windowCountAfter: null,
    })
    expect(JSON.stringify(getLastProtocolReceipt())).not.toContain("never-return-this")
    expect(JSON.stringify(getLastProtocolReceipt())).not.toContain("proof-123")
    recordProtocolDispatch(false, 1)
    expect(getLastProtocolReceipt()).toMatchObject({ activated: false, windowCountAfter: 1 })
  })

  it("observes but rejects malformed and cross-channel protocols", () => {
    expect(
      recordProtocolReceipt("flapstack://open", "flapstack-preview", "open-url").accepted,
    ).toBe(false)
    expect(recordProtocolReceipt("not a URL", "flapstack-dev", "initial-argv")).toMatchObject({
      accepted: false,
      protocol: null,
      host: null,
      pathname: null,
      queryKeys: [],
    })
  })
})
