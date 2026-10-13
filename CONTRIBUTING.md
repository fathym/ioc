---
FrontmatterVersion: 1
DocumentType: Guide
Title: Contributing
Summary: How to set up, test, document and propose changes to @fathym/ioc.
Created: 2026-10-13
Updated: 2026-10-13
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: Code of Conduct
    Path: ./CODE_OF_CONDUCT.md
  - Label: Security Policy
    Path: ./SECURITY.md
---

# Contributing

Thanks for helping. This guide covers setup, the test suites, documentation conventions and how
changes ship. Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
Report security issues privately, as described in [SECURITY](./SECURITY.md).

## Setup

You need [Deno](https://deno.com) 2.x.

```sh
git clone https://github.com/fathym/ioc.git
cd ioc
deno task test
```

## Tasks

| Task                      | Does                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `deno task test`          | All tests: the container suites, the docs checker's tests, and every example                                   |
| `deno task build`         | Format, lint, type-check, then the docs check and `deno doc --lint` (what CI runs)                             |
| `deno task docs:check`    | Frontmatter, links and anchors, orphans, footers, error catalog and `llms.txt`; runs every Markdown code block |
| `deno task docs:llms`     | Regenerate `llms.txt` from the docs' frontmatter                                                               |
| `deno task bench`         | Hot-path benchmarks against the frozen 0.0.36 implementation                                                   |
| `deno task build:npm`     | Build the npm package into `dist/npm` (ESM + `.d.ts`, compiled by TypeScript)                                  |
| `deno task test:runtimes` | Build the npm package, run the smoke test on Node.js and Bun, and type-check a consumer with TypeScript 5.4    |

## Test suites

| Suite                                         | Protects                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tests/ioc/bench.ts`                          | The original behavior tests (kept unchanged)                                                                                   |
| `tests/ioc/characterization.tests.ts`         | Behavior dependents rely on, run against both the frozen 0.0.36 container (`tests/fixtures/legacy-ioc.ts`) and the current one |
| `tests/ioc/interop.tests.ts`                  | `CopyTo` in both directions between versions (several versions run in one process)                                             |
| `tests/ioc/consumer-patterns.tests.ts`        | Code shapes taken from published dependents                                                                                    |
| `tests/ioc/matrix.tests.ts`, `model.tests.ts` | Generated combinations, and seeded random operation sequences against a reference model                                        |
| `tests/ioc/types.tests.ts`                    | Compile-time types (`@ts-expect-error` checks)                                                                                 |
| `tests/docs/*`                                | The docs checker, and every program in `examples/`                                                                             |
| `tests/runtimes/*`                            | A plain-JavaScript smoke test for Node.js and Bun, and a TypeScript consumer for the oldest supported compiler                 |

Rules:

- **Don't edit `tests/fixtures/legacy-ioc.ts`.** It is the frozen reference.
- **Don't change `tests/ioc/bench.ts` assertions.** If one has to change, it's a behavior change:
  document it in the [changelog](./CHANGELOG.md) and the migration guide.
- **Never use `#private` fields or `instanceof IoCContainer` across containers.** Containers from
  different versions call each other.

## Documentation

The docs live in [`docs/`](./docs/README.md), plus `README.md` and `examples/`. Conventions are in
the [docs hub](./docs/README.md#conventions).

**Adding a page:**

1. **Start with the house frontmatter:** `FrontmatterVersion`, `DocumentType`, `Title`,
   `Summary`, `Created`, `Updated`, `Owners`, `References`. `References` should include the
   parent folder's `README.md` and `AGENTS.md`.
2. **Use the right shape:**
   - how-to: open with `> **Goal:**`;
   - tutorial: one complete program per step;
   - concept: a summary, an explanation, then a table or diagram.
3. **Make every TypeScript block a complete module** importing from `'@fathym/ioc'`. The docs
   check type-checks _and runs_ it. Mark a deliberate fragment with `` ```ts ignore `` and say in
   the prose that it's a fragment.
4. **End with `## What's Next`,** a list of links tagged `_[Tutorial]_`, `_[How-to]_`,
   `_[Explanation]_` or `_[Reference]_`.
5. **Link the page from its folder's `README.md`.** The check fails on orphan pages.
6. **Run `deno task docs:llms`,** then `deno task docs:check`.

**Other rules:**

- **New error messages** need an entry in the
  [error catalog](./docs/reference/errors.md). The check compares every message in `src/`
  against it.
- **Links:** use relative links with the `.md` extension inside the repo. The README uses absolute
  `https://github.com/fathym/ioc/blob/main/…` links, because JSR renders it too.
- **Public API:** every exported symbol needs JSDoc (`deno doc --lint mod.ts`), and key APIs get an
  `@example`.

The GitHub issue and pull-request templates in `.github/` are the one exception to the frontmatter
rule. GitHub pastes them into new issues and PRs, so they keep no frontmatter. Their links are
still checked.

## Proposing a change

1. **Open an issue first for anything beyond a small fix,** so the design can be discussed.
2. **Keep the API additive.** A behavior change needs a [changelog](./CHANGELOG.md) entry under
   `[Unreleased]`, an entry in the migration guide, and tests.
3. **Make sure `deno task build` and `deno task test` pass.**
4. **Fill in the pull-request checklist.**

## Releasing

Releases are built and published by the shared `fathym/build-n-publish` workflow. Before a
release:

1. Move the `[Unreleased]` notes in the changelog under the new version.
2. Run `deno task test:runtimes --require-all` (CI runs it on Node.js 20, 22 and 24 and Bun).
3. Run the test suites of the main dependents against the release candidate.
4. JSR is the primary registry. To publish to npm as well, run
   `deno task build:npm --version=<version>`, then `npm publish dist/npm --access public`.
5. Record provenance in `UPSTREAM.md`, as described in `AGENTS.md`.

## What's Next

- The documentation hub: [docs/README.md](./docs/README.md)
- The design and its decisions: [ioc-next.md](./docs/design/ioc-next.md)
