---
FrontmatterVersion: 1
DocumentType: Guide
Title: Upstream and Provenance
Summary: Where @fathym/ioc comes from, where it is published, the versions pinned in the wild, and the frozen copies the tests run against.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Changelog
    Path: ./CHANGELOG.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
---

# Upstream and Provenance

## Source

- **Repository:** [github.com/fathym/ioc](https://github.com/fathym/ioc). This repository is the
  upstream; there is no fork to track. Fixes land here first.
- **Dependencies:** none at runtime. The build and tests use only the Deno standard library and
  the TypeScript compiler (for the npm package).

## Release channels

| Channel | Package                                               | Built by                                                |
| ------- | ----------------------------------------------------- | ------------------------------------------------------- |
| JSR     | [`@fathym/ioc`](https://jsr.io/@fathym/ioc) (primary) | The shared `fathym/build-n-publish` workflow            |
| npm     | `@fathym/ioc` (ESM + `.d.ts`)                         | `deno task build:npm --version=<version>`, then publish |

## Versions

| Version | Status                     | Notes                                                                           |
| ------- | -------------------------- | ------------------------------------------------------------------------------- |
| 0.0.36  | Latest published           | The original container; 0.0.12–0.0.36 share one API                             |
| 0.1.0   | Candidate (`[Unreleased]`) | Typed tokens, scopes, disposal, `Validate`, error codes, `Default`, strict mode |

**Versions pinned by dependents** (from the dependent survey in
[ioc-next.md](./docs/design/ioc-next.md)): 0.0.12 (`eac-runtime`), 0.0.35 (`eac-applications`)
and 0.0.36 (`cli`, `eac`). These load side by side with the current version in one process, which
is what the [cross-version protocol](./docs/reference/protocol.md) exists for.

## Frozen copies used by the tests

| Fixture                        | Frozen from         | Used by                               |
| ------------------------------ | ------------------- | ------------------------------------- |
| `tests/fixtures/legacy-ioc.ts` | 0.0.36              | Characterization and interop tests    |
| `tests/fixtures/ioc-0.1/`      | The 0.1.0 candidate | Interop tests for every later version |

A fixture is never edited after it is frozen (formatting and linting skip `tests/fixtures/`).
When 0.1.0 is published, check that the frozen copy matches the published `src/` and record the
commit here.

## Publishing checklist

1. Move the `[Unreleased]` notes in the [changelog](./CHANGELOG.md) under the new version.
2. Run the dependents' suites (`cli`, `eac-runtime`, `steward`) against the candidate through a
   local JSR override (`patch` / `links`).
3. Update the version table above with the published version and its commit.

## What's Next

- Contributing and the release steps: [CONTRIBUTING.md](./CONTRIBUTING.md)
- The design and its decisions: [ioc-next.md](./docs/design/ioc-next.md)
