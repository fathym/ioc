---
FrontmatterVersion: 1
DocumentType: Guide
Title: Evaluating @fathym/ioc
Summary: For teams deciding whether to depend on @fathym/ioc - support, stability, security, maintenance, the honest risks, and how to adopt it safely.
Created: 2026-11-01
Updated: 2026-11-01
Owners:
  - fathym
References:
  - Label: Documentation home
    Path: ./README.md
  - Label: Versioning and support policy
    Path: ./policy.md
  - Label: Guarantees
    Path: ./reference/guarantees.md
---

# Evaluating @fathym/ioc

> **Goal:** decide whether your team should depend on `@fathym/ioc`, with the evidence in one
> place.

A dependency injection container sits under the whole application, so the question isn't only
"is the API nice" but "can we rely on it". This page answers the questions reviewers ask, and
states the risks plainly.

## At a glance

| What                     | Where it stands                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Stable since             | 1.0, November 2026 (`1.0.18` was the first stable release); the 0.x line ran from 2025                                           |
| Breaking changes         | Only in a major release, with a migration guide ([policy](./policy.md#semantic-versioning))                                      |
| Behavior you can rely on | [Guarantees](./reference/guarantees.md), each linked to the test that proves it; CI fails if one is removed                      |
| Test coverage of `src/`  | 98.8% of lines, 97.1% of branches; CI fails below 97% / 95% (`deno task coverage`)                                               |
| Runtimes                 | Full suite on Deno 2; the published build on Node.js 20, 22 and 24 and Bun; TypeScript 5.4 and later                             |
| Size and dependencies    | About 6 KB minified and gzipped; no runtime dependencies                                                                         |
| Compared with others     | [The same scenarios and benchmarks](./reference/comparison.md) against InversifyJS, awilix and tsyringe                          |
| License                  | MIT                                                                                                                              |
| Maintainers              | Listed in [MAINTAINERS.md](../MAINTAINERS.md); new issues triaged within 5 business days, security reports acknowledged within 3 |

## Questions reviewers ask

- **What is the support commitment for 1.x?** The latest 1.x release gets bug and security fixes.
  Anything deprecated keeps working for at least one minor release and at least six months, and is
  removed only in a major release. Dropping a runtime version is announced a release ahead. The
  details are in the [versioning and support policy](./policy.md).
- **Are breaking changes limited to major releases?** Yes. The policy defines breaking precisely:
  exports, signatures, error codes, documented behavior (lifetimes, ordering, disposal, what
  `Validate()` reports, option defaults) and supported runtimes. Error message text is not part of
  the contract; error codes are.
- **How are security issues handled?** Privately, through GitHub security advisories, with an
  acknowledgement within three business days. See the [security policy](../SECURITY.md).
- **Is it feature-complete, and what's the roadmap?** It is intentionally small. A feature is added
  only when it fixes a bug real applications hit or replaces something they do by hand; the
  [design notes](./design/ioc-1.0.md) list what was left out and why. Expect fixes and small,
  additive minor releases, not a growing framework. Synchronous resolution of already-built
  services is the one addition under consideration.
- **Who else uses it in production?** Fathym's own platform, from its CLI to its runtime, runs on
  the 0.x line, and is moving to 1.0. Outside adoption is new. If you adopt it, tell us in an issue or a discussion; it helps everyone judge
  the same question.
- **What if the maintainers stop?** You can own it. It is MIT-licensed, has no dependencies, and is
  about 2,700 lines including its documentation comments, in one folder (`src/ioc/`). The tests
  and the docs check come with it.

## The honest risks

- **It is young.** The stable API dates from November 2026 and the user base is small, so there
  are fewer answers online than for InversifyJS, awilix or tsyringe.
- **Resolution is always asynchronous.** Every `Resolve` returns a promise. A resolve takes about a
  microsecond where the synchronous containers take a tenth of that or less; the
  [comparison](./reference/comparison.md#benchmarks) has the numbers. That rarely matters for an
  application, but code that must resolve synchronously can't use it.
- **Wiring is explicit.** Each class lists its `Deps`. The compiler checks them against the
  constructor, and `Validate()` checks the whole graph, but it is more code than auto-wiring.
- **Some advanced features are left out on purpose:** property injection, contextual bindings and
  auto-registration by scanning files.

## Adopting it safely

1. **Pin to the major version** (`^1` on npm or JSR), and read the changelog when you take a minor
   release.
2. **Validate the wiring in a test**, so a broken graph fails CI rather than a deploy:

   ```ts ignore
   // A fragment from a test file: build the app's container the way main.ts does, then check it.
   Deno.test('the container is wired correctly', () => {
     const app = buildContainer();

     app.Validate(); // throws IoCValidationError listing every problem
   });
   ```

3. **Start with one bounded service,** where async initialization and clean shutdown matter most,
   then expand.
4. **Check our claims yourself:** `deno task compare` re-runs the comparison, and every
   [guarantee](./reference/guarantees.md) links to its test.

## What's Next

- Five short steps from a first container to tests: [getting started](./getting-started/README.md)
  _[Tutorial]_
- What the container promises, with proof: [guarantees](./reference/guarantees.md) _[Reference]_
- What may change between releases: [versioning and support policy](./policy.md) _[Reference]_
