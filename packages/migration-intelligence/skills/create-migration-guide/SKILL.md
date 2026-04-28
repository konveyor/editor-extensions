---
name: create-migration-guide
description: >
  Interview the user and explore the codebase to create a migration guide skill.
  Use when analysis results exist but no migration guide has been created yet.
  Produces a SKILL.md saved to .konveyor/skills/ capturing migration context,
  key patterns, and organizational preferences.
---

# Create Migration Guide

## Purpose

Produce a migration guide skill that captures everything an agent needs to plan
and execute this migration: what the migration means, what patterns the codebase
uses, and what the organization's preferences are.

The output is a `SKILL.md` saved to `.konveyor/skills/{migration-name}/` following
the [Agent Skills](https://agentskills.io) format.

## When to Activate

- Analysis results are available (run `run_analysis` if not)
- No migration guide exists in `.konveyor/skills/`
- User wants to start a migration or create a plan

## Workflow

### Step 1: Understand the migration

Read the analysis results to identify the migration type (e.g., Java EE → Quarkus,
Spring Boot 2 → 3, EAP → JWS). Summarize what you found.

### Step 2: Explore the codebase

Use your file tools to explore the project structure. Focus on:

- Entry points, key services, and domain objects
- Frameworks, libraries, and patterns in use
- Anything that looks non-standard or org-specific

### Step 3: Ask structured questions

Ask the user targeted questions about things you cannot infer from the code.
Present options when possible (don't ask open-ended questions you could answer yourself).

Example questions:

- "I see both Kafka and RabbitMQ dependencies. Which should be used for messaging after migration?"
- "Should Flyway migrations be preserved as-is, or updated to match the new schema?"
- "Are there services that should NOT be migrated in this pass?"

### Step 4: Write the migration guide

Create `.konveyor/skills/{migration-slug}/SKILL.md` with:

```markdown
---
name: { migration-slug }
description: >
  Migration plan for {source} to {target}. Use when planning or executing
  a migration from {source} to {target} for this application.
---

# {Migration Title}

## Application Context

{Brief description of the application and its current state}

## Key Patterns

{Bullet list of patterns discovered in the codebase that affect the migration}

## Organizational Preferences

{Bullet list of preferences gathered from the user}

## Things to Watch

{Specific files, classes, or patterns that need special attention}
```

### Step 5: Confirm

Show the guide to the user and ask if they want to adjust anything before saving.

## References

See `references/example-migration-guide.md` for a complete example.
