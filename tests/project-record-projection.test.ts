import { expect, it } from "vitest"
import type { ProjectRecord, ProjectRecordSnapshot } from "../src/shared/project-records"
import {
  projectRecordGroups,
  projectBlockerEntries,
  projectAffectedWorkLabels,
} from "../src/renderer/features/project-records/project-record-projection"

function snapshot(path: string, records: ProjectRecord[]): ProjectRecordSnapshot {
  return {
    schemaVersion: 1,
    path,
    revision: "a".repeat(64),
    document: { schemaVersion: 1, title: "Records", records },
  }
}

it("groups actual projects across storage lanes while retaining one editable source identity", () => {
  const question = {
    id: "Q1",
    title: "Shared question",
    kind: "question" as const,
    state: "open",
    history: [],
    projects: [
      { id: "hunt", name: "Hunt" },
      { id: "flapstack", name: "Flapstack" },
      { id: "hunt", name: "Hunt" },
    ],
    answer: "Existing owner answer",
    draft: "Pending draft",
  }
  const source = snapshot("lanes/vault/questions.md", [question])
  const groups = projectRecordGroups([
    source,
    snapshot("projects/portfolio/features.md", [
      {
        id: "F1",
        title: "Hunt feature",
        kind: "feature",
        state: "planned",
        history: [],
        projects: [{ id: "hunt", name: "Hunt" }],
      },
    ]),
  ])
  expect(groups.map((group) => group.name)).toEqual(["Flapstack", "Hunt"])
  expect(groups[1]!.entries.map((entry) => entry.record.id)).toEqual(["Q1", "F1"])
  for (const group of groups) {
    const shared = group.entries.find((entry) => entry.record.id === "Q1")!
    expect(shared.record).toBe(question)
    expect(shared.snapshot).toBe(source)
  }
  expect(question.answer).toBe("Existing owner answer")
  expect(question.draft).toBe("Pending draft")
})

it("uses a document project only when known, leaving unassigned lane work shared", () => {
  const record: ProjectRecord = {
    id: "Q1",
    title: "Unassigned",
    kind: "question",
    state: "open",
    history: [],
  }
  const groups = projectRecordGroups([
    snapshot("lanes/vault/questions.md", [record]),
    snapshot("projects/ai-master-class/features.md", [{ ...record, id: "F1", kind: "feature" }]),
  ])
  expect(groups.map((group) => group.name)).toEqual(["Ai Master Class", "Shared work"])
  expect(groups.some((group) => group.id === "vault")).toBe(false)
})

it("uses exact support locators without hiding same-ID work in another document or guessing legacy ambiguity", () => {
  const task: ProjectRecord = {
    id: "TASK-01",
    title: "Blocked work",
    kind: "task",
    state: "blocked",
    history: [],
  }
  const support: ProjectRecord = {
    id: "BLOCK-01",
    title: "Blocker",
    kind: "blocker",
    state: "blocked",
    history: [],
    affectedWork: [],
    affectedWorkRefs: [{ path: "lanes/vault/tasks.md", recordId: task.id }],
  }
  const first = snapshot("lanes/vault/tasks.md", [task])
  const second = snapshot("lanes/flapstack/tasks.md", [{ ...task }])
  const blocker = snapshot("lanes/vault/questions.md", [support])
  const entries = [first, second, blocker].flatMap((snapshot) =>
    snapshot.document.records.map((record) => ({ snapshot, record })),
  )
  expect(projectBlockerEntries(entries).map((entry) => entry.snapshot.path)).toEqual([
    second.path,
    blocker.path,
  ])
  support.affectedWorkRefs = []
  support.affectedWork = [task.id]
  expect(projectBlockerEntries(entries)).toHaveLength(3)
  expect(projectBlockerEntries([entries[0]!, entries[2]!])).toEqual([entries[2]])
  support.affectedWork = []
  support.affectedWorkRefs = [{ path: "projects/missing/features.md", recordId: task.id }]
  expect(projectBlockerEntries(entries)).toHaveLength(3)
  expect(projectAffectedWorkLabels(support)).toEqual(["projects/missing/features.md#TASK-01"])
  support.affectedWorkRefs = [{ path: first.path, recordId: task.id }]
  task.kind = "feature"
  expect(projectBlockerEntries(entries)).toHaveLength(2)
  task.kind = "question"
  expect(projectBlockerEntries(entries)).toHaveLength(3)
})
