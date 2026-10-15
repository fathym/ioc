---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Container Guide
Summary: Playbook for maintaining the Fathym IoC container for Deno runtimes.
Created: 2025-11-20
Updated: 2026-10-15
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
  - Label: IoC 1.0 (design)
    Path: ./docs/design/ioc-1.0.md
  - Label: IoC Next (the 0.1 design)
    Path: ./docs/design/ioc-next.md
  - Label: DI Ecosystem Feedback (research)
    Path: ./docs/research/di-ecosystem-feedback.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
---

# IoC Container Guide

Use this playbook to keep IoC container work predictable and discoverable.

## Current Focus

- Keep the 1.0 guarantees covered by tests: strict, lazy and timeout-bounded
  containers, reference keys (tokens and classes), sealed module registrations,
  typed modules, scope levels, and the layered `Start()`/`Dispose()` lifecycle
  (`tests/ioc/*.tests.ts`).
- Follow the [versioning policy](./docs/policy.md): breaking changes only in a
  major release, each with a migration guide.
- Keep the documentation in `docs/` complete and verified: `deno task docs:check` runs every
  example and checks links, frontmatter, footers and the error catalog.
- Align APIs with other ref-arch libraries and the CLI where integration
  matters. See [`docs/design/ioc-1.0.md`](./docs/design/ioc-1.0.md).

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
