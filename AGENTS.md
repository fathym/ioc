---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Agents Guide
Summary: Guardrails for collaborating on the Fathym IoC container pod.
Created: 2025-11-20
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: 'Projects: Ref-Arch README'
    Path: ../README.md
  - Label: 'Projects: Ref-Arch AGENTS'
    Path: ../AGENTS.md
  - Label: 'Projects: Ref-Arch Guide'
    Path: ../GUIDE.md
  - Label: Root README
    Path: ../../../README.md
  - Label: Root Agents Guide
    Path: ../../../AGENTS.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
---

# AGENTS: IoC Container

Guardrails for humans and AI collaborating on the Fathym IoC container.

## Core Guardrails

1. **Stay scoped.** Keep IoC work under `projects/ref-arch/ioc/` unless
   coordinating with another pod; link cross-pod dependencies when they exist.
2. **Frontmatter required.** Every Markdown doc uses frontmatter and
   document-relative references back to parent guides.
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
  - `docs/` holds the tutorial, concepts, guides, reference and migration guides.
  - `examples/` holds runnable programs.
- **Every page** has the house frontmatter, is linked from its folder `README.md`, and ends with
  `## What's Next`.
- **Every TypeScript block is a complete module** importing `'@fathym/ioc'`. Mark a deliberate
  fragment with `ts ignore`, and say so in the prose.
- **Every new error message gets an entry** in `docs/reference/errors.md`.
- **After adding or renaming a page,** run `deno task docs:llms`.
- **Run `deno task docs:check` before committing docs.** `deno task build` includes it.
- **Exception:** the GitHub issue and PR templates in `.github/` carry no frontmatter, because
  GitHub pastes them into issues and PRs verbatim.

## Communication

- Declare intent before editing; summarize outcomes and next steps in the
  project README or a short log.
- Link implementation branches and consumer pods (CLI, other libraries,
  micro-frameworks) when behavior changes to keep dependencies aligned.
