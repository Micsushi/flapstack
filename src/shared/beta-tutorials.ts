import type { BetaFeatureId } from "./beta-features"

type TutorialStep = { title: string; body: string }

export const BETA_TUTORIALS: Record<BetaFeatureId, readonly TutorialStep[]> = {
  workspaceEditing: [
    {
      title: "Open a connected file",
      body: "Enable File editing, then open a text file from a chat's worktree. Unconnected files, image previews and Markdown previews remain read-only.",
    },
    {
      title: "Save deliberately",
      body: "Edit the text and choose Save. Your unsaved draft is kept separately from the file. Autosave is optional for each editor.",
    },
    {
      title: "Review a conflict",
      body: "If the file changes on disk, review that version before saving. When a file cannot be reopened, recover its saved draft by copying the text or using Save As new file.",
    },
    {
      title: "Reverse a file change",
      body: "Use file undo and redo to reverse a saved change. In Review saved file, choose Discard draft to use the reviewed disk version without changing the file. App Undo restores that draft; newer typing is preserved.",
    },
  ],
  diffAnnotations: [
    {
      title: "Open a change",
      body: "Enable Code review comments and open a chat's diff. Select the relevant text lines and write a comment about the change you want.",
    },
    {
      title: "Review before sending",
      body: "Edit or remove draft comments, then select the comments to send. Check the destination conversation before submitting feedback.",
    },
    {
      title: "Track the feedback",
      body: "Sent comments show their delivery and run status. Retry a failed delivery through its existing action. Cancellation stops pending work where possible; it cannot undo edits already made by an agent.",
    },
  ],
  streamedFileSearch: [
    {
      title: "Search your workspace",
      body: "Enable Search while scanning and open the file search dialog. Type part of a filename. Results arrive as the workspace scan progresses.",
    },
    {
      title: "Choose a result",
      body: "Use the arrow keys to select a file and Enter to open it. Your selection follows the file as arriving results change the order.",
    },
    {
      title: "Retry an interrupted search",
      body: "If discovery fails, partial results remain visible with an error. Choose Retry for a fresh scan. Changing the query or closing the dialog stops delivery to the old search.",
    },
  ],
  terminalRecovery: [
    {
      title: "Start a new terminal",
      body: "Enable Restore terminal output before opening a new terminal. Terminals already open keep the mode they were created with.",
    },
    {
      title: "Return to its output",
      body: "Leave the terminal view, then reopen that terminal. Output continues to update while its view is detached and is restored when you return.",
    },
    {
      title: "Know the boundary",
      body: "After app restart, saved output returns stopped: up to 1,000 scrollback rows for 32 terminals. Choose Start new terminal to start a process. Commands are never replayed; abrupt crashes can lose the latest unsaved output.",
    },
  ],
  projectMemory: [
    {
      title: "Open project knowledge",
      body: "Enable Project knowledge and select a project. Open its knowledge sections to keep reusable context alongside that project's work.",
    },
    {
      title: "Choose context",
      body: "Review and edit the sections, then choose which context should accompany runs. Keeping a note does not by itself grant an agent additional permissions.",
    },
    {
      title: "Protect newer edits",
      body: "If a section changes elsewhere, review the conflict before replacing it. Use the available backups to inspect and recover a prior section.",
    },
  ],
  orchestration: [
    {
      title: "Prepare the workers",
      body: "Enable Agent workflows. Choose compatible agent profiles and runtime targets, then inspect each worker's task, permissions and worktree before launch.",
    },
    {
      title: "Follow the work",
      body: "Start the reviewed workflow and inspect its activity. Open each worker's chat to see its conversation and its relationship to the initiating chat.",
    },
    {
      title: "Pause or recover",
      body: "Use workflow pause, resume and stop controls when available. Inspect a failed step before retrying it. A child cannot exceed the authority delegated to it.",
    },
  ],
  savedWorkspaces: [
    {
      title: "Arrange your views",
      body: "Enable Saved layouts and arrange the chats and panes you want to return to. Save the layout with a name you will recognize.",
    },
    {
      title: "Restore a layout",
      body: "Open the saved layout to restore its views. Restoring a layout does not start provider work or rerun commands.",
    },
    {
      title: "Resolve missing views",
      body: "If a referenced chat, file or worktree is unavailable, inspect the reported missing binding instead of assuming it was restored. Update the saved layout after choosing the views you need.",
    },
  ],
  automations: [
    {
      title: "Define a bounded task",
      body: "Enable Automations and create an automation. Choose its target, prompt and trigger, such as a schedule or file change.",
    },
    {
      title: "Review before enabling",
      body: "Review the model, permissions, approval requirements and limits before enabling it. Creating an automation and authorizing it to run are separate actions.",
    },
    {
      title: "Inspect the result",
      body: "Use the inbox and run history to check results or failures. Disable future triggers when no longer needed; inspect and cancel active work separately.",
    },
  ],
  planning: [
    {
      title: "Inspect the plan",
      body: "Enable Work board & plans, select a project and open its plan sources. Read a candidate's source before promoting it into work.",
    },
    {
      title: "Review proposed tasks",
      body: "Review the scope and acceptance criteria of each proposal before approving it. A plan item or proposal is not yet a running agent.",
    },
    {
      title: "Work from the board",
      body: "Open the task on the board, then use its available chat action. If a source or record changed, refresh and review the difference before retrying; keep the existing task identity.",
    },
  ],
  branchesAndWorktrees: [
    {
      title: "Open the repository overview",
      body: "Enable Branches & worktrees. Use the selected project's repository overview action to inspect its branches and worktrees.",
    },
    {
      title: "Check the checkout",
      body: "Inspect the branch and path for the worktree you intend to use. A detached checkout is not attached to a branch, and a missing path cannot be treated as an available workspace.",
    },
    {
      title: "Keep inspection separate",
      body: "This overview is read-only. Viewing another branch or worktree does not switch the active checkout, move files or authorize an agent run.",
    },
  ],
}
