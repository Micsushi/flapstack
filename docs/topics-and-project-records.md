# Topics and project records

Enable **Settings → Beta features → Planning** to show **Topics** for a selected
project. Capture a mixed note to group fixes and future ideas, or choose a single
capture kind. The original note stays available through each group's source link.
Failed grouping keeps the original as an unsorted topic.

Topics keep a short editable summary, questions, choices, written answers and
annotations. Changing a choice or writing an answer saves a recovery draft;
**Submit answer** records the answer. **Mark read** changes only its read state.
Topic status, running agents and accepted project work are separate.
New captures and submitted answers refresh the summary when the local model is
available. Recovery drafts do not change the summary.

In a chat header, **Assign role** gives that chat an explicit discussion, lead or
worker role. Leads and workers can link to related chats in the same project.
The control shows the local host. These owner assignments are separate from
inferred labels and do not start or delegate work. Remove links before moving a
chat to another project or changing a role that other chats link to.

Use a message's annotation action to select user or assistant text, or an image
region. Text anchors preserve the exact quote and position. A changed source is
shown as stale. Follow-ups stay beside the annotation; **Promote to topic**
creates a linked topic. Local model replies use text and image-region metadata;
image pixels are not sent to the model.

Reopen the source message's annotation action to choose a saved annotation.
**Open promoted topic** opens its linked discussion, including older topics beyond
the currently loaded page.

## Local replies

Run an installed Ollama chat model locally and set these variables before starting
Flapstack:

```text
FLAPSTACK_DISCUSSION_OLLAMA_URL=http://127.0.0.1:11434
FLAPSTACK_DISCUSSION_MODEL=<installed chat model name>
```

Mixed grouping and summary refresh use the same model. Generation is bounded to
one request at a time and never launches tools or workers. Model suggestions are
editable. Grouping selects immutable source spans, checks full source coverage
and supplied record IDs, then asks the model to check meaning. It can correct a
failed proposal once before keeping the original unsorted. If the model is
unavailable, captures and drafts remain saved.

Automatic grouping remains experimental. The current local-model check rejected
a correction that should have reused an existing topic. Single-topic capture,
editable summaries and saved questions remain usable while grouping needs work.

Canonical comparison checks a bounded set of relevant topics and indexed project
features. A successful comparison does not prove that every possible duplicate
was found. The UI states when canonical comparison was unavailable.

## Canonical project records

**Project records** reads the local project-records writer API. Its Markdown files
remain the authority for features, lane questions, outcomes and acceptance. Set:

```text
FLAPSTACK_PROJECT_RECORDS_URL=http://127.0.0.1:47831
FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE=<private token file outside the repository>
```

The writer and Flapstack must use the same token. Credentials stay in the app
backend. No Markdown parser or second records database lives in the renderer.

Select a project, then open **Questions**, **Completed** or **Checklist**. Records
use their explicit project assignments even when stored in a shared lane. A
record shared by several projects keeps one saved answer and history. Unassigned
lane records appear under **Shared work**. Search the selected view or expand its
evidence and history.
Completed contains finished outcomes only. Unfinished and superseded outcomes
remain in Checklist with their actual status; answered questions stay in Questions.
Questions distinguish AI recommendations and resolutions from saved owner
answers. Recommendations never fill your answer automatically. Older answers
without recorded authorship remain labelled as unverified.
**Save draft** and **Submit answer** use revision checks. A conflict keeps the
pending draft and shows the current canonical record for review. **Owner accepted**
records T3 acceptance only; it does not merge code, publish or deploy.

Undo and redo use the shared action history. A newer conflicting edit prevents
undo from overwriting that work. Cross-device dispatch and history synchronization
remain a separate phase; the existing mobile companion connects to one desktop.
