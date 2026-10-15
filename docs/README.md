---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc Documentation'
Summary: The map of the @fathym/ioc docs - tutorial, concepts, how-to guides, reference, migration and background.
Created: 2026-10-13
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Project README
    Path: ../README.md
  - Label: Project Agents Guide
    Path: ../AGENTS.md
  - Label: Contributing
    Path: ../CONTRIBUTING.md
---

# @fathym/ioc Documentation

Small, async-first, decorator-free dependency injection for Deno, built for large applications.
These docs take you from your first container to running a platform of modules in production,
with every code example type-checked and run in CI.

## Start here

Pick the path that fits you:

| If you are…                                | Start with                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| New to dependency injection                | [What is IoC?](./what-is-ioc.md) _[Explanation]_ → [Getting started](./getting-started/README.md) _[Tutorial]_          |
| Experienced, and want to see the API       | [Registering services](./guides/registering-services.md) _[How-to]_ → [API reference](./reference/api.md) _[Reference]_ |
| Coming from InversifyJS, tsyringe, awilix… | [Migrating from other containers](./migration/from-other-containers.md) _[How-to]_                                      |
| Upgrading from 0.0.x or 0.1                | [Migrating from 0.x](./migration/from-0.x.md) _[How-to]_                                                                |
| Stuck on an error                          | [Error catalog](./reference/errors.md) _[Reference]_ → [Troubleshooting](./troubleshooting.md) _[How-to]_               |

## Overview

| Document                                           | Description                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| [what-is-ioc.md](./what-is-ioc.md) _[Explanation]_ | The problem a container solves, what you gain, and when not to use one |
| [comparison.md](./comparison.md) _[Explanation]_   | How this container compares with the alternatives, honestly            |
| [faq.md](./faq.md) _[Reference]_                   | Short answers to common questions                                      |
| [policy.md](./policy.md) _[Reference]_             | Versioning, deprecations, supported runtimes and how releases are made |

## Getting Started

| Document                                                     | Description                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| [getting-started/](./getting-started/README.md) _[Tutorial]_ | Build a small notes API in five steps, from install to tests |

## Concepts

| Document                                                                          | Description                                                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [concepts/](./concepts/README.md) _[Explanation]_                                 | How the container thinks                                                      |
| [keys-and-registrations.md](./concepts/keys-and-registrations.md) _[Explanation]_ | Tokens and classes as reference keys, names, and how a registration is stored |
| [lifetimes.md](./concepts/lifetimes.md) _[Explanation]_                           | Singleton, transient and scoped, and when each is built                       |
| [scopes.md](./concepts/scopes.md) _[Explanation]_                                 | Child scopes, overrides, and what a scope is (and isn't)                      |
| [async-resolution.md](./concepts/async-resolution.md) _[Explanation]_             | Shared creation, retries, timeouts and thenables                              |
| [disposal.md](./concepts/disposal.md) _[Explanation]_                             | Who owns what, and the order things are cleaned up                            |
| [cycles-and-errors.md](./concepts/cycles-and-errors.md) _[Explanation]_           | Cycle detection, resolution paths and their limits                            |
| [scale.md](./concepts/scale.md) _[Explanation]_                                   | Which features to use for a script, a service, and a platform                 |
| [design-principles.md](./concepts/design-principles.md) _[Explanation]_           | Why it is decorator-free, async-first and stable                              |

## Guides

| Document                                                                           | Description                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [guides/](./guides/README.md) _[How-to]_                                           | Task-focused recipes                                             |
| [registering-services.md](./guides/registering-services.md) _[How-to]_             | Pick the right way to register anything                          |
| [declared-dependencies.md](./guides/declared-dependencies.md) _[How-to]_           | Typed `Deps`, and typed containers that check registration order |
| [async-initialization.md](./guides/async-initialization.md) _[How-to]_             | Connections, warm-up, retries and fail-fast startup              |
| [per-request-scopes.md](./guides/per-request-scopes.md) _[How-to]_                 | One scope per HTTP request, with any framework                   |
| [testing.md](./guides/testing.md) _[How-to]_                                       | Copy-paste recipes for overriding and resetting services         |
| [plugins-and-named-services.md](./guides/plugins-and-named-services.md) _[How-to]_ | Several implementations of one key                               |
| [decorating-services.md](./guides/decorating-services.md) _[How-to]_               | Add logging, caching or retries around a service                 |
| [organizing-registrations.md](./guides/organizing-registrations.md) _[How-to]_     | Structure the composition root of a real app                     |
| [modules-and-lifecycle.md](./guides/modules-and-lifecycle.md) _[How-to]_           | Typed modules, sealing, defaults, start layers and shutdown      |
| [building-frameworks.md](./guides/building-frameworks.md) _[How-to]_               | Rules for libraries and frameworks that contribute services      |
| [guidelines.md](./guides/guidelines.md) _[How-to]_                                 | Named anti-patterns, each with the fix                           |

## Patterns

| Document                                                                 | Description                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [patterns/](./patterns/README.md) _[How-to]_                             | Whole-application architectures, each with a complete example |
| [plugin-host.md](./patterns/plugin-host.md) _[How-to]_                   | Frameworks and runtimes extended by plugins                   |
| [cli-app.md](./patterns/cli-app.md) _[How-to]_                           | Command-line tools with a scope per command                   |
| [multi-tenant-runtime.md](./patterns/multi-tenant-runtime.md) _[How-to]_ | Tenant and request levels in one server                       |
| [agent-orchestrator.md](./patterns/agent-orchestrator.md) _[How-to]_     | Parallel agents with private state and shared tools           |
| [resolver-chains.md](./patterns/resolver-chains.md) _[How-to]_           | Ordered, extensible handler chains                            |
| [keyed-resources.md](./patterns/keyed-resources.md) _[How-to]_           | Named connections, opened lazily and always closed            |
| [testing.md](./patterns/testing.md) _[How-to]_                           | Tests on the real wiring with a few things swapped            |

## Reference

| Document                                              | Description                                          |
| ----------------------------------------------------- | ---------------------------------------------------- |
| [reference/](./reference/README.md) _[Reference]_     | Reference index                                      |
| [api.md](./reference/api.md) _[Reference]_            | Every method, option and type                        |
| [errors.md](./reference/errors.md) _[Reference]_      | Every error message, what it means and how to fix it |
| [glossary.md](./reference/glossary.md) _[Reference]_  | The terms these docs use                             |
| [troubleshooting.md](./troubleshooting.md) _[How-to]_ | Symptoms that aren't errors, and their causes        |

## Migration

| Document                                                                    | Description                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [migration/](./migration/README.md) _[How-to]_                              | Migration index                                                             |
| [from-0.x.md](./migration/from-0.x.md) _[How-to]_                           | Upgrading from 0.0.x and 0.1 to 1.0                                         |
| [from-other-containers.md](./migration/from-other-containers.md) _[How-to]_ | API mappings from InversifyJS, tsyringe, awilix, needle-di and typed-inject |

## Examples

Runnable programs, each showing one idea, run in CI: [examples/](../examples/README.md).

## Background

| Document                                                                                 | Description                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [design/ioc-1.0.md](./design/ioc-1.0.md) _[Explanation]_                                 | The 1.0 design: reference keys, sealing, typed modules, safe defaults |
| [design/ioc-next.md](./design/ioc-next.md) _[Explanation]_                               | The 0.1 design, which 1.0 builds on                                   |
| [design/dependent-follow-ups.md](./design/dependent-follow-ups.md) _[How-to]_            | Adoption changes for the packages that depend on this one             |
| [research/di-ecosystem-feedback.md](./research/di-ecosystem-feedback.md) _[Explanation]_ | What developers like and dislike about other DI containers            |

---

## Quick Reference

### API at a glance

| Task                         | Call                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Register a class             | `ioc.RegisterClass(Repo)`                                                                  |
| Register with dependencies   | `ioc.RegisterClass(Repo, { Deps: [Config, $Logger] })`                                     |
| Check registration order     | `new IoCContainer().Typed().RegisterClass(Config).RegisterClass(Repo, { Deps: [Config] })` |
| Declare a key from elsewhere | `.Expect($Request)` on a typed container                                                   |
| Create a key                 | `const $Db = IoCToken<Db, 'Db'>('Db')` (export it to share it)                             |
| Register a factory           | `ioc.RegisterFactory($Db, async (c) => openDb())`                                          |
| Register a value             | `ioc.RegisterValue($Port, 8080)`                                                           |
| Resolve                      | `await ioc.Resolve(Repo)` / `await ioc.Resolve($Db, 'replica')`                            |
| Maybe resolve                | `await ioc.TryResolve($Db)` / `ioc.Has($Db)`                                               |
| All named implementations    | `await ioc.ResolveAll($Plugin)`                                                            |
| Per-request scope            | `await using scope = ioc.CreateScope()`                                                    |
| Wrap a service               | `ioc.Decorate($Db, (inner) => withLogging(inner))`                                         |
| Check wiring / build early   | `ioc.Validate()` / `await ioc.Activate()` (`Start()` does both)                            |
| Clean up                     | `await ioc.Dispose()` / `await using ioc = new IoCContainer()`                             |
| Define a typed module        | `DefineModule({ Name: 'Db', Needs: [$Url], Register: (ioc) => ioc.RegisterClass(Db) })`    |
| Modules and lifecycle        | `ioc.Use(Db, Server)` / `await ioc.Start()` / `ioc.State`                                  |
| Overridable default          | `ioc.RegisterValue($Logger, consoleLogger, { Default: true })`                             |
| Declare scope levels         | `new IoCContainer({ Levels: ['tenant', 'request'] })`                                      |
| Per-tenant instance          | `RegisterClass(TenantDb, { ScopeLevel: 'tenant' })`                                        |
| A scope's own copy           | `ioc.CreateScope({ Level: 'agent' }).Isolate(Memory)`                                      |
| Services by name / as a bag  | `await ioc.ResolveNamed($Profile)` / `await ioc.ResolveRecord({ db: $Db })`                |
| Inject lazily / all of a key | `Deps: [IoCLazy($Mailer), IoCAll($Plugin)]`                                                |
| Swap in a test               | `new IoCContainer({ Testing: true })`, then `const restore = ioc.Override($Clock, fake)`   |
| Inspect the wiring           | `ioc.Describe()`                                                                           |

### Lifetimes

| Lifetime            | Instances              | Built when                                                         |
| ------------------- | ---------------------- | ------------------------------------------------------------------ |
| singleton (default) | one, shared everywhere | first resolve, or `Start()` / `Activate()`                         |
| `transient`         | a new one per resolve  | on every resolve                                                   |
| `scoped`            | one per scope          | first resolve in each scope (the root throws `IOC_SCOPE_REQUIRED`) |

### Errors

| Error                           | Usually means                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `IoCServiceNotFoundError`       | Nothing registered under that key and name                                                        |
| `IoCCircularDependencyError`    | Two services need each other                                                                      |
| `IoCValidationError`            | `Validate()` found wiring problems (all listed)                                                   |
| `IoCContainerDisposedError`     | The container or scope was used after `Dispose()`                                                 |
| `IoCStartError`                 | A module's `OnStart` failed (the start was rolled back)                                           |
| `IoCSealedError`                | A module changing another module's (or the app's) registration, or `Override()` outside `Testing` |
| `IoCDuplicateRegistrationError` | The same key and name registered twice without `Replace: true`                                    |

Every error has a stable `code`; see the [error catalog](./reference/errors.md).

## For AI Consumption

These docs are written for both people and AI coding assistants:

- Every code example is a complete module importing from `'@fathym/ioc'`, and it type-checks in
  CI.
- [`llms.txt`](../llms.txt) lists every page with a one-line summary.
- The [error catalog](./reference/errors.md) is keyed by exact message text.
- The [guidelines](./guides/guidelines.md) name each anti-pattern, with WRONG and CORRECT code.

## Conventions

How these docs are written. [CONTRIBUTING](../CONTRIBUTING.md#documentation) explains how to add a
page.

- **Frontmatter on every page** in the house schema (`FrontmatterVersion`, `DocumentType`,
  `Title`, `Summary`, `Created`, `Updated`, `Owners`, `References`).
- **Each page leads with the reader's goal.** How-to guides open with `> **Goal:**`.
- **One concept per example.** Each example is a complete module of about 30 lines or fewer, with
  realistic names. Tokens are written `IoCToken<T, 'Name'>('Name')`.
- **1.0 as it is.** Concept, guide and reference pages describe the current API only; changes
  from 0.x live in the [migration guide](./migration/from-0.x.md) and the
  [changelog](../CHANGELOG.md).
- **Links are tagged by type** (_[Tutorial]_, _[How-to]_, _[Explanation]_, _[Reference]_), and
  every page ends with **What's Next**.
- **Limits are stated plainly.** No page implies a capability the container doesn't have.

## What's Coming

- Docs site publication alongside the other Fathym docs.
- Recipes for more frameworks as they are requested ([open a docs issue](../.github/ISSUE_TEMPLATE/docs_problem.yml)).
