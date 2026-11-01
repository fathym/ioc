---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Container Guide
Summary: Playbook for maintaining @fathym/ioc on Deno, Node.js and Bun.
Created: 2025-11-20
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
  - Label: IoC 1.0 (design)
    Path: ./docs/design/ioc-1.0.md
---

# IoC Container Guide

Use this playbook to keep IoC container work predictable and discoverable.

## Current Focus

- Keep the 1.0 core covered by tests: strict, lazy and timeout-bounded containers,
  typed tokens (`Symbol.for` names) and class keys, scopes and disposal, modules with an
  ordered `Start()`/`Dispose()` lifecycle, typed modules and `Validate()`
  (`tests/ioc/*.tests.ts`).
- Hold new features to the rule in [`docs/design/ioc-1.0.md`](./docs/design/ioc-1.0.md): a
  feature earns a place only if it fixes a bug the Fathym repositories can hit, or replaces
  something they do by hand today.
- Follow the [versioning policy](./docs/policy.md): breaking changes only in a
  major release, each with a migration guide.
- Keep the documentation in `docs/` complete and verified: `deno task docs:check` runs every
  Markdown and JSDoc code block, type-checks `examples/`, and checks links, frontmatter, footers
  and the error catalog; `deno task test` runs the examples.
- Keep the API consistent with the libraries that depend on it. See
  [`docs/design/ioc-1.0.md`](./docs/design/ioc-1.0.md).

## Workflow

1. **Align scope** in an issue or the pull request: note the intended change (feature, fix,
   release prep).
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
- Docs pages link with relative paths; the landing `README.md` links with absolute GitHub URLs,
  because JSR renders it too.
