import { atom } from "jotai"

/** One-shot handoff from automation history/inbox to the canonical chat run evidence widget. */
export const automationEvidenceRunIdAtom = atom<string | null>(null)
