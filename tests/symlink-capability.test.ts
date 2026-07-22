import { describe, expect, it } from "vitest"
import { requireFileSymlinkCoverage } from "./helpers/symlink-capability"

describe("file symlink security coverage", () => {
  it("fails closed when CI requires file symlink coverage but Windows cannot create one", () => {
    expect(() =>
      requireFileSymlinkCoverage(false, {
        FLAPSTACK_REQUIRE_FILE_SYMLINK_TESTS: "1",
      }),
    ).toThrow(/file symlink security tests cannot run/i)
  })

  it("allows an unsupported local host only when strict coverage is not requested", () => {
    expect(() => requireFileSymlinkCoverage(false, {})).not.toThrow()
    expect(() =>
      requireFileSymlinkCoverage(true, {
        FLAPSTACK_REQUIRE_FILE_SYMLINK_TESTS: "1",
      }),
    ).not.toThrow()
  })
})
