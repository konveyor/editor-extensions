# Migration Intelligence — Agent Instructions

This package provides migration intelligence for Konveyor-guided migrations.
It is consumed by agents running in the IDE (VS Code), CLI, or hub containers.

## What This Package Contains

- **Skills** (`skills/`) — reusable migration workflows in the [Agent Skills](https://agentskills.io) format
- **Prompts** (`prompts/`) — workflow prompt templates for skill creation, plan generation, and phased execution
- **This file** — agent instructions for Claude Code, Cursor, and similar agents

## How to Use This Package

When working on a Konveyor migration, you have access to three migration workflows
defined as skills in this package. Read each skill's `SKILL.md` to understand when
and how to activate it.

### Available Skills

1. **create-migration-guide** — Interview the user, explore the codebase, and produce
   a migration guide skill saved to `.konveyor/skills/`. Use this when no migration
   guide exists yet for the current project.

2. **generate-migration-plan** — Read existing skills and analysis results, then produce
   a phased migration plan. Use this when a migration guide exists and the user wants
   a plan for how to execute the migration.

3. **execute-migration-phase** — Execute one phase of an approved migration plan,
   re-analyze, and prompt the user before proceeding. Use this when a plan exists
   and the user is ready to start or continue execution.

### Intelligence Layering

Context is assembled from three sources (later sources extend or override earlier ones):

1. **This package** — built-in skills and prompts (defaults)
2. **Hub-distributed** — architect-authored skills from `.konveyor/profiles/{id}/skills/`
3. **Workspace-local** — user or agent-created skills from `.konveyor/skills/`

### Analysis Tools

Analysis capabilities (run_analysis, get_analysis_results, get_incidents_by_file)
come from the Konveyor MCP server — not from this package. This package provides
migration context and workflow instructions only.

## Format

Skills follow the [Agent Skills](https://agentskills.io) format:

- Each skill is a directory containing a `SKILL.md` with YAML frontmatter
- Agents load only `name` and `description` at discovery time
- Full instructions are read only when the skill is activated
