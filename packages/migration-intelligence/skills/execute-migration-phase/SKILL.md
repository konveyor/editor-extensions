---
name: execute-migration-phase
description: >
  Execute one phase of an approved migration plan. Re-analyzes after each phase
  and prompts the user before proceeding to the next. Use when a migration plan
  exists and the user is ready to start or continue execution.
---

# Execute Migration Phase

## Purpose

Execute migration changes one phase at a time, with user review and re-analysis
between phases. Ensures changes are correct before proceeding and catches
cascading issues early.

## When to Activate

- An approved migration plan exists in `.konveyor/skills/`
- User wants to start or continue executing the migration

## Workflow

### Step 1: Load the plan

Read the migration plan skill from `.konveyor/skills/`. Identify:

- Which phase to execute (ask the user if unclear)
- What files are in scope
- What the acceptance criteria are

### Step 2: Execute the phase

Apply all changes for this phase using your file tools. Follow the migration
guide's organizational preferences. Do not make changes outside this phase's scope.

### Step 3: Re-analyze

Run `run_analysis` after completing the phase's changes. Compare results to
the pre-phase baseline:

- How many incidents were resolved?
- Did any new incidents appear?
- Are there cascading issues that affect the next phase?

### Step 4: Present results

Show the user:

- What changed (summary of files modified)
- Analysis delta (incidents resolved vs. new incidents)
- Any issues that need attention before proceeding

Ask structured questions if input is needed:

- "3 new incidents appeared in OrderService. Should I fix these now or defer to Phase 3?"
- "CartService has a pattern that doesn't match the migration guide. Here are two options: [A] or [B]. Which do you prefer?"

### Step 5: Confirm before next phase

Do not proceed to the next phase without explicit user confirmation.
Present: "Phase {N} complete. Ready to start Phase {N+1}: {name}? ({M} incidents, {K} files)"

## Important Constraints

- Never modify files outside the current phase's scope
- Always re-analyze before asking the user to confirm
- If analysis fails, report the error and wait for user input
- Preserve all organizational preferences from the migration guide
