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
    expect(
      sanitizeHarnessEnvelopeEcho(
        "[FLAPSTACK PRODUCT MCP]\nhidden tool guidance\n[/FLAPSTACK PRODUCT MCP]\nOPENROUTER_RESUME_OK",
      ),
    ).toBe("OPENROUTER_RESUME_OK")
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

  it("removes a complete nonce-bound BEGIN/END USER REQUEST envelope", () => {
    const nonce = "3f2a9c0b7d1e4f5a6b8c9d0e1f2a3b4c"
    expect(
      sanitizeHarnessEnvelopeEcho(
        `Visible first.\n--- BEGIN USER REQUEST ${nonce} ---\nprivate prompt\n--- END USER REQUEST ${nonce} ---\nVisible last.`,
      ),
    ).toBe("Visible first.\nVisible last.")
  })

  it("hides an unmatched BEGIN through end of chunk even when a decoy mismatched-nonce END is present", () => {
    const beginNonce = "3f2a9c0b7d1e4f5a6b8c9d0e1f2a3b4c"
    const endNonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const text = `Visible first.\n--- BEGIN USER REQUEST ${beginNonce} ---\nprivate prompt\n--- END USER REQUEST ${endNonce} ---\nVisible last.`
    expect(sanitizeHarnessEnvelopeEcho(text)).toBe("Visible first.")
  })

  it("still removes the envelope once the real same-nonce END arrives after a decoy END", () => {
    const beginNonce = "3f2a9c0b7d1e4f5a6b8c9d0e1f2a3b4c"
    const decoyNonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const text =
      `Visible first.\n--- BEGIN USER REQUEST ${beginNonce} ---\n` +
      `private prompt\n--- END USER REQUEST ${decoyNonce} ---\nmore private prompt\n` +
      `--- END USER REQUEST ${beginNonce} ---\nVisible last.`
    expect(sanitizeHarnessEnvelopeEcho(text)).toBe("Visible first.\nVisible last.")
  })

  it("hides an unfinished trailing nonce-bound BEGIN USER REQUEST envelope while streaming", () => {
    const nonce = "3f2a9c0b7d1e4f5a6b8c9d0e1f2a3b4c"
    expect(
      sanitizeHarnessEnvelopeEcho(
        `Visible first.\n--- BEGIN USER REQUEST ${nonce} ---\nprivate prompt so far`,
      ),
    ).toBe("Visible first.")
    expect(
      sanitizeHarnessEnvelopeEcho(`Visible first.\n--- BEGIN USER REQUEST ${nonce.slice(0, 8)}`),
    ).toBe("Visible first.")
    expect(sanitizeHarnessEnvelopeEcho("Visible first.\n--- BEGIN USER REQUEST")).toBe(
      "Visible first.",
    )
  })

  it("preserves ordinary inline discussion of the nonce envelope marker syntax", () => {
    expect(
      sanitizeHarnessEnvelopeEcho(
        "Explain the --- BEGIN USER REQUEST <nonce> --- boundary in this protocol.",
      ),
    ).toBe("Explain the --- BEGIN USER REQUEST <nonce> --- boundary in this protocol.")
  })
})
