---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Agents Guide
Summary: Guardrails for humans and AI agents contributing to @fathym/ioc.
Created: 2025-11-20
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: Contributing
    Path: ./CONTRIBUTING.md
---

# AGENTS: IoC Container

Guardrails for humans and AI collaborating on the Fathym IoC container.

## Core Guardrails

1. **Stay scoped.** Keep each change to one concern; the core stays small (see the rule in
   [`docs/design/ioc-1.0.md`](./docs/design/ioc-1.0.md)).
2. **Frontmatter required.** Every Markdown doc except the landing `README.md` and the GitHub
   templates uses the house frontmatter, with document-relative references inside the repository.
3. **API stability.** Avoid breaking registration/resolution semantics without
   migration notes; document changes that affect consumers (CLI, other
   libraries, micro-frameworks).
4. **Provenance.** Capture upstream sources, release channels, and version pins
   in `UPSTREAM.md` when publishing; prefer upstream-first fixes before
   diverging.
5. **Security & hygiene.** Do not include secrets in tests or docs; keep build
   and test tasks reproducible.

## Documentation

The docs are a product surface: every example runs in CI and every page follows one set of
conventions. The details are in [CONTRIBUTING](./CONTRIBUTING.md#documentation) and the
[docs hub](./docs/README.md#conventions).

- **Where things go:**
  - `README.md` is the landing page; it links into `docs/` with absolute GitHub URLs, because JSR
    renders it too.
  - `docs/` holds the tutorial, the reference, the migration guide, design notes and the policy.
  - `examples/` holds runnable programs.
- **Every docs page** has the house frontmatter, is linked from its folder `README.md`, and ends with
  `## What's Next`.
- **Every TypeScript block is a complete module** importing `'@fathym/ioc'`. Mark a deliberate
  fragment with `ts ignore`, and say so in the prose.
- **Every new error message gets an entry** in `docs/reference/errors.md`.
- **After adding or renaming a page,** run `deno task docs:llms`.
- **Run `deno task docs:check` before committing docs.** `deno task build` includes it.
- **Exceptions:** the landing `README.md` and the GitHub issue and PR templates in `.github/`
  carry no frontmatter, because GitHub and JSR render the README as-is and GitHub pastes the
  templates into issues and PRs verbatim.

## Communication

- Declare intent before editing; summarize outcomes and next steps in the pull request.
- When behavior changes, record it in the [changelog](./CHANGELOG.md) and, for breaking
  changes, the migration guide, so dependents can follow.
