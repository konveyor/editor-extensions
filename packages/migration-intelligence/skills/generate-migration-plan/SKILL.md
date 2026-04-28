---
name: generate-migration-plan
description: >
  Read existing migration guide skills and analysis results to produce a phased
  migration plan. Use when a migration guide exists in .konveyor/skills/ and the
  user wants a structured plan for executing the migration in phases.
---

# Generate Migration Plan

## Purpose

Produce a phased migration plan that breaks the migration into manageable,
reviewable chunks. Each phase should be independently executable and result
in a compilable, testable codebase.

The output is a `SKILL.md` saved to `.konveyor/skills/{migration-name}-plan/`
that captures the full plan and can be referenced during execution.

## When to Activate

- A migration guide exists in `.konveyor/skills/`
- Analysis results are available
- User wants a plan before starting execution

## Workflow

### Step 1: Load context

Read all skills in `.konveyor/skills/` and `.konveyor/profiles/*/skills/`.
Get analysis results via `get_analysis_results`.

### Step 2: Group incidents into phases

Organize incidents into logical phases. Good phase boundaries:

- All changes of one type (e.g., all `@Stateless` → `@ApplicationScoped`)
- Changes scoped to one layer (e.g., persistence layer only)
- Changes with no inter-dependencies

Each phase should:

- Be completable in one agent session
- Leave the codebase in a compilable state
- Have clear acceptance criteria

### Step 3: Draft the plan

Structure:

```markdown
# Migration Plan: {title}

## Summary

{2-3 sentences describing the migration and approach}

## Phases

### Phase 1: {name}

**Goal:** {what this phase achieves}
**Incidents:** {N} incidents across {M} files
**Files:** {list key files}
**Acceptance:** {how to verify this phase is complete}

### Phase 2: {name}

...
```

### Step 4: Present and refine

Show the plan to the user. Ask if they want to:

- Reorder phases
- Split or merge phases
- Exclude anything from this pass

### Step 5: Save the plan

Save to `.konveyor/skills/{migration-slug}-plan/SKILL.md` once approved.
