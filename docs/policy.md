---
FrontmatterVersion: 1
DocumentType: Guide
Title: Versioning and Support Policy
Summary: What @fathym/ioc promises from 1.0 - semantic versioning and what counts as breaking, the deprecation window, supported runtimes, how releases are made, and how security fixes ship.
Created: 2026-10-15
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: Changelog
    Path: ../CHANGELOG.md
  - Label: Security policy
    Path: ../SECURITY.md
  - Label: Contributing
    Path: ../CONTRIBUTING.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
---

# Versioning and Support Policy

This page is the contract between `@fathym/ioc` and the code that depends on it, from 1.0.0 on.
Read it to know which upgrades are safe to take without reading the changelog, and how much
warning you get before something goes away.

## Semantic versioning

Releases follow [Semantic Versioning 2.0.0](https://semver.org/):

| Release             | May contain                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Patch** (`1.0.x`) | Bug fixes and documentation. No new API.                                                    |
| **Minor** (`1.x.0`) | New API, new options, new error codes and events, deprecations. Nothing breaks.             |
| **Major** (`x.0.0`) | Breaking changes, each listed in the changelog with a migration guide in `docs/migration/`. |

### What counts as breaking

The public API is everything exported from `@fathym/ioc` (`mod.ts`) and documented in the
[API reference](./reference/api.md). A change is **breaking**, and only ships in a major release,
when it:

- **removes or renames an export,** a public method, an option, or a public property of an error
  or a description (`Describe()`);
- **changes a public type or signature** so that code which compiled and ran correctly before no
  longer does, on the [supported TypeScript versions](#supported-runtimes);
- **removes an error code, renames one, or changes what it means,** or makes a condition throw a
  different code than before;
- **changes documented behavior:** lifetimes and ownership, resolution order, start and stop
  order, disposal order, sealing rules, what `Validate()` reports, and the default value of any
  option (such as `PendingTimeoutMs`);
- **drops a supported runtime,** except as described under
  [supported runtimes](#dropping-a-runtime-version).

### What doesn't count

These can change in any release:

- **Error message text.** Messages are written for people and may gain detail or be reworded.
  Match on `code` (`isIoCError(err, code)`), never on the message.
- **New members of open sets:** a new `IoCErrorCode`, `IoCWarningCode`, `IoCEvent` type or
  `IoCValidationIssue` `Kind` arrives in a minor release. Code that switches over them should keep
  a default branch.
- **New optional fields** on options, events, issues and descriptions.
- **Fixes to undocumented behavior,** including type changes that only reject code that would
  already have failed at runtime. Each is listed in the changelog under _Fixed_.
- **Internals:** members marked `@ignore` or `protected`, the `'@fathym/ioc/…'` marker properties
  on types, timing (`Ms`, `BuildMs`, `StartMs` values), the order of entries the docs don't
  promise, and performance.
- **Development tooling:** scripts, tests, CI and the docs themselves.

When a bug fix has to change documented behavior because the documented behavior is unsafe (for
example, a security issue), it ships in a minor release with a changelog entry under _Changed_
that says so plainly.

## Deprecation

Nothing is removed without warning. A deprecated API:

1. **gets a JSDoc `@deprecated` tag** that names its replacement, so editors and `deno doc` show
   it;
2. **gets a changelog entry** under _Deprecated_ in the release that deprecates it, and a section
   in the next major release's migration guide;
3. **keeps working** for **at least one minor release and at least six months**, whichever is
   longer;
4. **is removed only in a major release.**

A deprecated behavior that can't carry a JSDoc tag (an option value, an implicit default) is
announced the same way, and may also emit an `OnEvent` warning when it is used.

## Supported runtimes

| Runtime    | Supported versions | Checked in CI                                   |
| ---------- | ------------------ | ----------------------------------------------- |
| Deno       | 2.x                | Full test suite, docs examples                  |
| Node.js    | 20.16+, 22, 24     | Smoke test against the npm build                |
| Bun        | 1.x                | Smoke test against the npm build and the source |
| TypeScript | 5.4 and later      | A consumer type-checked with TypeScript 5.4     |

The package has no runtime dependencies. The container never imports `node:async_hooks`; where
the runtime offers `AsyncLocalStorage` through `process.getBuiltinModule` (all of the above), it
is used to follow resolution chains across `await`. **Node.js 20 needs 20.16 or later** for that:
`process.getBuiltinModule` arrived in 20.16, and on older 20.x releases the automatic async context
is silently off (pass your own `AsyncLocalStorage` with the `AsyncContext` option there). The
supported minimum is therefore Node.js 20.16. Other ES2022 runtimes, browsers included, may work
but aren't tested.

### Dropping a runtime version

**Dropping a runtime version after its upstream end of life is a minor release, announced at
least one minor release ahead** under _Deprecated_ in the changelog. So is raising the minimum
TypeScript version to one released at least a year earlier. **Dropping a whole runtime, or a
version that its maintainers still support, is a major release.**

**Why a minor, with notice:** runtime versions end on a schedule everyone can see (Node.js 20,
for example, reached its end of life in April 2026), and a project on an end-of-life runtime
already gets no security fixes from its runtime. Requiring a major release for each of those
would force a new major version roughly every year, and every major release asks every dependent
to read a migration guide. A minor release with advance notice keeps majors for real API changes,
while a project pinned to `^1` still gets a full release cycle of warning, and can stay on the
last minor that supports its runtime.

## Releases

1. **Changelog first.** Every change that affects users lands with an entry under _Unreleased_ in
   the [changelog](../CHANGELOG.md). Before a release, those entries move under the new version.
   A release without changelog entries isn't made.
2. **The version comes from the commit.** The release commit's message carries `(MAJOR)` or
   `(MINOR)`; any other commit to `main` is a patch.
3. **Checks before publishing:** `deno task build` (format, lint, type check, docs check),
   `deno task test`, `deno task test:runtimes --require-all`, and the test suites of the main
   dependents against the release candidate.
4. **JSR from CI, npm from the same commit.** The `fathym/build-n-publish` workflow publishes to
   [JSR](https://jsr.io/@fathym/ioc), the primary registry. The npm package is built from the same
   released commit with `deno task build:npm --version=<version>` and published with the same
   version number.
5. **Provenance** (sources, release channels, version pins) is recorded in `UPSTREAM.md`.

The step-by-step checklist is in [CONTRIBUTING](../CONTRIBUTING.md#releasing).

## Security fixes

- **Report privately,** as described in the [security policy](../SECURITY.md). Don't open a
  public issue.
- **Fixes ship as a patch release** of the latest minor version, as soon as a fix is ready, with
  a changelog entry and a GitHub security advisory.
- **After a new major release,** the last minor release of the previous major receives security
  fixes for at least six months.
- **0.x releases receive no fixes.** Upgrade with the [migration guide](./migration/from-0.x.md).

## What's Next

- What changed in each release: [CHANGELOG](../CHANGELOG.md) _[Reference]_
- Upgrading from 0.x: [from-0.x.md](./migration/from-0.x.md) _[How-to]_
- Every public method, option and type: [api.md](./reference/api.md) _[Reference]_
