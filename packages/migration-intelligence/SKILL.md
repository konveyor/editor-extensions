---
name: migration-intelligence
description: >
  Konveyor migration intelligence workflows. Use when helping a user plan or
  execute a migration guided by Konveyor analysis results. Provides three
  workflows: creating a migration guide, generating a phased plan, and executing
  migration phases.
---

# Migration Intelligence

This package provides migration intelligence for Konveyor-guided migrations.
See `AGENTS.md` for full agent instructions.

## Quick Reference

| Skill                     | When to use                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `create-migration-guide`  | No migration guide exists yet — interview user and explore codebase |
| `generate-migration-plan` | Migration guide exists — produce a phased execution plan            |
| `execute-migration-phase` | Plan approved — execute one phase at a time                         |
