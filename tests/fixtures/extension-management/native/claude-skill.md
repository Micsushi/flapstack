---
description: Review the current change safely
when_to_use: Use for focused code review
argument-hint: "[path]"
arguments:
  - path
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - Read
  - Grep
disallowed-tools: Write Edit
model: inherit
effort: high
context: fork
agent: general-purpose
hooks:
  Stop:
    - hooks:
        - type: command
          command: ./verify.sh
paths:
  - src/**
shell: bash
future-field:
  enabled: true
---

Review the requested path.

