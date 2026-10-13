---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Container Guide
Summary: Playbook for maintaining the Fathym IoC container for Deno runtimes.
Created: 2025-11-20
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
  - Label: 'Projects: Ref-Arch README'
    Path: ../README.md
  - Label: 'Projects: Ref-Arch Guide'
    Path: ../GUIDE.md
  - Label: IoC Next (design and migration)
    Path: ./docs/design/ioc-next.md
  - Label: DI Ecosystem Feedback (research)
    Path: ./docs/research/di-ecosystem-feedback.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
---

# IoC Container Guide

Use this playbook to keep IoC container work predictable and discoverable.

## Current Focus

- Validate container lifecycle behaviors (transient, scoped, scopes) and symbol
  registration patterns. The legacy suite (`tests/ioc/bench.ts`) and the
  characterization tests run against the frozen 0.0.36 container in
  `tests/fixtures/legacy-ioc.ts`; keep both green.
- Keep cross-version interop working: dependents pin different exact versions,
  so containers from several versions call each other's `CopyTo`
  (`tests/ioc/interop.tests.ts`). Never use `#private` fields or `instanceof`
  across containers.
- Keep the documentation in `docs/` complete and verified: `deno task docs:check` runs every
  example and checks links, frontmatter, footers and the error catalog.
- Align APIs with other ref-arch libraries and the CLI where integration
  matters. See [`docs/design/ioc-next.md`](./docs/design/ioc-next.md).

## Workflow

1. **Align scope** in [`README.md`](./README.md): note intended change (feature,
   fix, release prep) and target repo/branch if it moves.
2. **Design & docs**: capture API proposals in `docs/design/`, and update the
   user docs (`docs/`, `examples/`) in the same change as the code. Follow the
   conventions in [`CONTRIBUTING.md`](./CONTRIBUTING.md#documentation).
3. **Capture provenance**: record upstream source, release channel, and version
   pins in `UPSTREAM.md` once publishing.
4. **Validate behavior**: run `deno task test` (container suites, docs checker
   tests and every example) and `deno task build` (format, lint, types, docs
   check, `deno doc --lint`) before pushing; use `deno task deploy` for releases.
5. **Communicate changes**: document breaking changes with migration guidance
   and notify consumers (CLI, other libraries, micro-frameworks).

## Verification

- `deno task docs:check` passes (links, anchors, frontmatter, orphans, What's
  Next sections, error catalog, `llms.txt`, runnable examples).
- Ensure links stay relative and parent guides remain discoverable.
- Keep the roster entry in `../README.md` current when docs or status change.
- When workspace tasks exist, also run: `deno task prompts:verify-frontmatter`,
  `deno task link:verify`, `deno task workspace:check`.
