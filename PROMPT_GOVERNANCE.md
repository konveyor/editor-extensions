# Prompt Template Governance

This document defines the change-management lifecycle for the LLM **prompt templates**
that drive Developer Lightspeed for MTA. It exists to satisfy ISO/IEC 42001 Control
**A.5.2 (Governance and lifecycle of AI systems)**: because the built-in prompts are the
core instruction set defining system behavior, they are treated as governed source code —
version-controlled, peer-reviewed, and validated by CI before distribution.

## Scope — what is governed

All model-bound prompt templates live as individual file assets under
[`prompts/templates/`](prompts/templates/) and are enumerated in
[`prompts/manifest.yaml`](prompts/manifest.yaml). This currently covers:

| Surface       | Examples                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `agentic`     | analysis fix, diagnostics planner/general/Java-deps fixes, summarization, tool-call instructions |
| `single-shot` | the non-agentic Continue.dev quick-action prompt                                                 |
| `operational` | model capability health-check probe                                                              |

Prompts are rendered by [Handlebars](https://handlebarsjs.com/) via
`renderPrompt(id, context)` exported from `@editor-extensions/prompts`. Loops, conditionals,
and per-language branching live **in the template assets** (not in compiled application
code). The prompt-set is semantically versioned by `version:` in the manifest, kept in
lockstep with the Developer Lightspeed release in the root `package.json`.

> Out of scope: the Kai **solution server** generates hints with its own prompts; those are
> owned in the separate [`konveyor/kai`](https://github.com/konveyor/kai) repository and are
> governed there. See the audit evidence ledger for the boundary.

## Roles

- **Prompt Engineer / Product Architect** (`@konveyor/kai-prompt-reviewers`) — required
  approver for any change under `prompts/`. Owns prompt wording, the threat-model review,
  and the semantic-regression baseline.
- **IDE maintainers** (`@konveyor/kai-ide-reviewers`) — co-reviewers for the code that
  consumes prompts.

`prompts/` is assigned to these teams in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## Lifecycle of a prompt change

1. **Branch & edit** the template asset(s) under `prompts/templates/`. Do not edit prompt
   strings inline in application code — they are extracted by design.
2. **Refresh checksums & version.** Run `node scripts/prompts-version.js update`. Bump
   `version:` in the manifest if the change ships in a new release.
3. **Update parity expectations.** The byte-exact parity oracle
   (`prompts/tests/oracle.ts`) is the historical baseline. For an _intentional_ wording
   change, update the oracle + drift snapshots (`npm test -w @editor-extensions/prompts -- -u`)
   and call the change out explicitly in the PR description.
4. **Complete the prompt-injection threat-model checklist** (below) in the PR.
5. **Open a PR.** CODEOWNERS routes it to a Prompt Engineer; the
   [`prompt-validation`](.github/workflows/prompt-validation.yml) workflow runs automatically.
6. **Merge** only after required review + green CI.

## CI gates

The `prompt-validation` workflow (triggered on `prompts/**`) runs:

- **Syntactic verification** — every Handlebars template parses; declared placeholders
  resolve; no leftover `${...}` JS interpolation escaped into an asset.
- **Manifest/version governance** — every asset is declared (and vice-versa); content
  checksums match (drift detection).
- **Byte-exact parity** — each template reproduces its baseline output exactly.
- **Drift snapshots** — any wording change surfaces as a reviewable snapshot diff.
- **Semantic regression (deterministic, mock model)** — renders prompts against a baseline
  migration dataset and asserts required scaffolding (output contract, code under
  migration, incidents, language dependency guidance, migration target) survives.

## Prompt-injection threat-model checklist

Complete for every template change that adds or alters an interpolation point:

- [ ] **Untrusted interpolation** — which variables carry user/codebase-derived content
      (`inputFileContent`, incident messages, file URIs)? Confirm they are data-only and
      cannot be mistaken by the model for instructions.
- [ ] **Instruction-override risk** — could injected content plausibly cancel or redirect
      the system instruction? Are system vs. human roles still clearly separated?
- [ ] **Output-contract integrity** — do the output-format anchors (e.g. `## Updated File`)
      remain unambiguous so a malicious payload can't spoof the parser?
- [ ] **Escaping** — rendering is non-HTML-escaped by design; confirm no new context
      (shell, JSON, code fence) where unescaped interpolation enables an injection.
- [ ] **Tool exposure** — for tool-enabled prompts, does the change widen what the model is
      told it may do? Re-confirm the tool allow-list.
- [ ] **Regression** — semantic-regression baseline still passes; threshold unchanged or
      justified.

## Branch protection (repo admin action — not in code)

Branch protection is a GitHub repository setting and cannot be committed. A repository admin
must, for `main` and `release-*`:

1. **Require the status check** `Validate prompt templates` (job `validate-prompts`).
2. **Require review from Code Owners**, so `prompts/**` edits need
   `@konveyor/kai-prompt-reviewers` sign-off.
3. **Require the team** `@konveyor/kai-prompt-reviewers` to exist with the designated
   Prompt Engineers / Product Architects as members.
