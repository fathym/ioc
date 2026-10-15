---
FrontmatterVersion: 1
DocumentType: Guide
Title: Upstream and Provenance
Summary: Where @fathym/ioc comes from, where it is published, its versions and the versions pinned by dependents.
Created: 2026-10-13
Updated: 2026-10-15
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

| Version | Status                 | Notes                                                                                                                                                   |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0.36  | Latest published       | The original container; 0.0.12–0.0.36 share one API                                                                                                     |
| 0.1.0   | Superseded by 1.0      | Typed tokens, scopes, disposal, `Validate`, error codes, `Default`, strict mode, modules and lifecycle, scope levels, `Describe`                        |
| 1.0.0   | Releasing (major bump) | Reference keys, sealed module registrations, typed modules, safe defaults, layered lifecycle; no 0.x compatibility ([design](./docs/design/ioc-1.0.md)) |

**Versions pinned by dependents** (from the dependent survey in
[ioc-next.md](./docs/design/ioc-next.md)): 0.0.12 (`eac-runtime`), 0.0.35 (`eac-applications`)
and 0.0.36 (`cli`, `eac`). 1.0 does not interoperate with 0.x containers; each dependent moves to
1.0 with the [migration guide](./docs/migration/from-0.x.md).

## Publishing checklist

1. Move the `[Unreleased]` notes in the [changelog](./CHANGELOG.md) under the new version.
2. Run the dependents' suites (`cli`, `eac-runtime`, `steward`) against the candidate through a
   local JSR override (`patch` / `links`).
3. Update the version table above with the published version and its commit.

The [versioning policy](./docs/policy.md) says what each kind of release may change.

**How the version is chosen.** The `fathym/build-n-publish` workflow computes it on every push
with `paulhatch/semantic-version`: each commit bumps the patch, a commit whose message contains
`(MINOR)` bumps the minor version, and `(MAJOR)` the major. `main` publishes the stable version;
other branches publish a prerelease suffixed with the branch name. The workflow then writes the
version into `deno.jsonc`, publishes to JSR and tags the commit.

## What's Next

- Contributing and the release steps: [CONTRIBUTING.md](./CONTRIBUTING.md)
- The design and its decisions: [ioc-1.0.md](./docs/design/ioc-1.0.md)
