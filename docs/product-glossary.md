# Flapstack Product Glossary

This glossary keeps Flapstack's product language consistent across requests,
UI copy, specifications, and implementation work. Terms listed together in one
row are accepted synonyms for the same concept and share one description. Use
the bold term in product UI unless a row includes a context qualifier.

Similar-looking terms in separate rows are intentionally different. In
particular, a **sidebar section** is not a **Chat group**, and a Flapstack
**Task** is not normally a **Chat**.

| Canonical term and accepted synonyms                                                                          | Shared description                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Agent** · coding agent · worker                                                                             | An actor that performs work through one or more bounded runs. When the agent has its own independently addressable conversation, Flapstack represents that identity as a Chat.                                                             |
| **Agent Profile** · profile · named-agent profile                                                             | A local, versioned definition of an agent's capability and presentation settings. A profile configures an agent; it is not the running agent itself.                                                                                       |
| **Archive** · archived items                                                                                  | The recoverable area for objects hidden from their normal active lists. Archiving is not deletion.                                                                                                                                         |
| **Chat** · thread · conversation · agent chat · Codex task (when referring to a Codex conversation)           | One durable, independently addressable agent identity and its conversation. Chat is the canonical Flapstack UI term. Follow-up messages add runs to the same Chat.                                                                         |
| **Chat group** · group · multi-pane group · pane group                                                        | A named workbench layout containing multiple Chat panes or tabs. It organizes visible Chats without changing their Project or Task ownership. A bare “group” means this only when the context is the Chat workbench.                       |
| **Coordinator** · orchestrator · lead agent · parent agent                                                    | An agent whose primary role is to assign, monitor, or combine work performed by other agents or subagents.                                                                                                                                 |
| **Draft Chat** · new-Chat draft · unsent Chat                                                                 | A not-yet-durable Chat composition state. It becomes a Chat when the first message is submitted and creation succeeds.                                                                                                                     |
| **Harness** · agent harness · agent integration                                                               | The integration or protocol Flapstack uses to control an agent system, such as Codex or Claude Code. A harness is distinct from the provider, model, and Runtime.                                                                          |
| **Model** · AI model · LLM                                                                                    | The specific model selected to produce an agent response. It is supplied through a provider and used through a compatible harness and Runtime.                                                                                             |
| **Pane** · Chat pane · panel · split                                                                          | One visible region of a workbench group or Workspace. A Chat pane displays one active Chat; other pane types may display a terminal, diff, file, or browser.                                                                               |
| **Project** · codebase · repo · repository · project folder (when they refer to the same registered codebase) | A registered working context that usually points to a local codebase and contains Project Chats, Tasks, and Task Chats. “Repo,” “repository,” and “project folder” are accepted only when the Project maps to that same codebase.          |
| **Projects section** · default Projects section · main project list                                           | The fixed sidebar section that contains Projects not placed in Quick access or a custom sidebar section. It cannot be renamed, reordered below custom sections, or removed.                                                                |
| **Provider** · AI provider · model provider                                                                   | The service or account that supplies model access and usage data. A provider is distinct from the model, harness, and Runtime.                                                                                                             |
| **Quick access** · Quick access section                                                                       | The fixed first sidebar section for Projects the user wants readily available. It cannot be renamed, moved below custom sections, or removed.                                                                                              |
| **Run** · agent run · execution · activation                                                                  | One bounded activation of an existing agent in a Chat. A prompt or automation trigger starts it; success, failure, or cancellation ends it. A new run does not create a new Chat or agent identity.                                        |
| **Runtime** · Agent Runtime                                                                                   | The selected transport and lifecycle implementation used to launch and control one agent. It resolves separately from the provider, model, and Agent Profile.                                                                              |
| **Sidebar section** · project section · custom section · user section                                         | A sidebar bucket that contains Projects. Quick access and Projects are fixed sidebar sections; user-created sections appear below both, can be renamed or removed, and return their Projects to the default Projects section when removed. |
| **Subagent** · child agent · spawned agent · delegated agent                                                  | An agent created by another agent to perform delegated work. A subagent with its own independently addressable conversation receives its own Chat and retains lineage to its coordinator or parent Chat.                                   |
| **Tag** · label · Chat tag                                                                                    | Short metadata attached to a Chat for filtering or recognition, optionally paired with an icon. A tag does not change Chat ownership, hierarchy, or agent behavior.                                                                        |
| **Task** · work item · project task                                                                           | A Project-scoped unit of planned work that can contain Task Chats and related context. In Flapstack, Task is distinct from Chat; when discussing the Codex app, however, “Codex task” may mean a Chat/thread.                              |
| **Window** · app window · workbench window                                                                    | An independent Flapstack desktop window that contains one workbench layout. A window may contain one or more Chat groups and panes.                                                                                                        |
| **Workspace** · Saved Workspace · saved layout                                                                | A named, restorable Project- or Task-scoped arrangement of panes, tabs, and supported tools. It preserves layout and references; it does not replace the underlying Project, Task, Chat, or worktree.                                      |
| **Worktree** · Git worktree · checkout                                                                        | A local working directory backed by a Git branch or revision and used as execution context. A Project or Task may choose one, but the worktree is not the Project or Task itself.                                                          |

## Ambiguity rules

- Prefer **Chat** in Flapstack UI copy. Interpret “thread” and “conversation” as
  Chat unless the speaker explicitly means an internal provider identifier.
- Interpret “Codex task” as a Chat when discussing Codex's conversation UI, and
  **Task** as a work item when discussing Flapstack's Project hierarchy.
- Interpret “section” as a sidebar Project bucket and “group” as a multi-pane
  Chat layout. Do not use them interchangeably.
- “Workspace” can mean a generic working directory in external tools. In
  Flapstack product language, use **Workspace** only for the saved layout and
  **worktree** or **Project folder** for filesystem context.
- If context does not safely resolve an overloaded term, state the assumed
  meaning or ask one short question before changing data or UI behavior.

## Maintenance rule

Add a synonym only when it is repeatedly used or explicitly confirmed. Keep
synonyms on the same row as their canonical term so they cannot drift into
different descriptions. Add a separate row when two terms represent different
objects, even if they are often confused.
