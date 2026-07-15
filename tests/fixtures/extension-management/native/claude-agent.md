---
name: reviewer
description: Review code without changing it
model: opus
tools:
  - Read
  - Grep
disallowedTools:
  - Write
  - Edit
permissionMode: plan
maxTurns: 12
skills:
  - code-review
mcpServers:
  - github
hooks:
  Stop:
    - hooks:
        - type: command
          command: ./verify.sh
memory: project
background: true
effort: high
isolation: worktree
color: purple
initialPrompt: Start with the current diff
x-provider:
  color: purple
  retries: 2
---

Review carefully.

Preserve this spacing.
