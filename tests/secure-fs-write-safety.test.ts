import { expect, it } from "vitest"
import { validateRelativePath } from "../src/main/lib/git/security/path-validation"

it("rejects Windows drive-relative paths on every host", () => {
  expect(() => validateRelativePath("C:outside.txt")).toThrowError(
    expect.objectContaining({ code: "ABSOLUTE_PATH" }),
  )
})
