import { describe, expect, it } from "vitest"
import { sanitizeHarnessEnvelopeEcho } from "../src/shared/harness-envelope-sanitizer"

describe("harness envelope sanitizer", () => {
  it("removes complete and streaming prompt envelopes that begin on their own line", () => {
    expect(
      sanitizeHarnessEnvelopeEcho(
        "Visible first.\n[USER REQUEST]\nprivate prompt\n[/USER REQUEST]\nVisible last.",
      ),
    ).toBe("Visible first.\nVisible last.")
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n[FILE:/private/context]\npartial")).toBe(
      "Visible first.",
    )
  })

  it("preserves ordinary inline discussion of envelope marker syntax", () => {
    expect(sanitizeHarnessEnvelopeEcho("Explain the [USER REQUEST] marker in this protocol.")).toBe(
      "Explain the [USER REQUEST] marker in this protocol.",
    )
    expect(sanitizeHarnessEnvelopeEcho("The token [FILE:demo] can appear in documentation.")).toBe(
      "The token [FILE:demo] can appear in documentation.",
    )
  })

  it("preserves ordinary final lines that merely begin like a marker", () => {
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n[FIXME] keep this")).toBe(
      "Visible first.\n[FIXME] keep this",
    )
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n[Future work] keep this")).toBe(
      "Visible first.\n[Future work] keep this",
    )
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n--- Budget note ---")).toBe(
      "Visible first.\n--- Budget note ---",
    )
    for (const line of ["-", "--", "---", "["]) {
      expect(sanitizeHarnessEnvelopeEcho(`Visible first.\n${line}`)).toBe(`Visible first.\n${line}`)
    }
  })

  it("still hides genuine partial trailing envelope markers", () => {
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n[FLAP")).toBe("Visible first.")
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n[FILE:/private/context")).toBe(
      "Visible first.",
    )
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n--- BEGIN LOADED")).toBe("Visible first.")
  })
})
