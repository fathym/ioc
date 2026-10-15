---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc'
Summary: Small, async-first, decorator-free dependency injection for Deno, safe by default and built for large applications - reference keys, sealed typed modules, scopes and a layered lifecycle.
Created: 2025-11-20
Updated: 2026-10-15
Owners:
  - fathym
References:
  - Label: Documentation
    Path: ./docs/README.md
  - Label: Project Agents Guide
    Path: ./AGENTS.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: Contributing
    Path: ./CONTRIBUTING.md
  - Label: Changelog
    Path: ./CHANGELOG.md
  - Label: 'Projects: Ref-Arch README'
    Path: ../README.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
---

# @fathym/ioc

**Small, async-first, decorator-free dependency injection for Deno, built for large applications.**

[![JSR](https://jsr.io/badges/@fathym/ioc)](https://jsr.io/@fathym/ioc)
[![JSR Score](https://jsr.io/badges/@fathym/ioc/score)](https://jsr.io/@fathym/ioc/score)
[![Build](https://github.com/fathym/ioc/actions/workflows/build.yml/badge.svg)](https://github.com/fathym/ioc/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/fathym/ioc/blob/main/LICENSE)

Register your services once, resolve them anywhere, and let the container handle creation order,
async startup, per-request scopes and cleanup. No decorators, no `reflect-metadata`, no build
step. Many teams can add modules to one container without stepping on each other.

## Why this container

**Built for large apps:**

- **Safe by default.** `new IoCContainer()` has no modes to pick. Registering the same key twice
  throws unless you say `Replace: true`. Nothing is built until it is needed or `Start()` runs.
  Anything still pending after 30 seconds fails with a list of what it waits on, and a cycle
  throws instead of hanging, even across `await`.
- **Keys are references, so encapsulation is free.** `IoCToken<T, 'Name'>('Name')` makes a new,
  unique key on every call, and a class key is the class itself. Share a service by exporting
  its token; keep it private by not exporting it. Two teams can't collide on a name.
- **Sealed, typed modules.** What a module registers belongs to it: nobody else can replace,
  decorate or unregister it, unless the module registered it with `Default: true`. With
  `DefineModule`, a module declares what it `Needs`, and `Use()` on a typed container doesn't
  compile until those are registered. Each module type-checks its own short chain, so big apps
  stay fast to compile.
- **Lifecycle at scale.** `Start()` validates the wiring, builds every singleton, then starts
  modules by layer: each one after the modules it requires, independent ones at the same time.
  A failed start cleans up completely and can be retried. `Dispose()` (or `await using`) stops
  modules in reverse, then disposes child scopes and instances. `State`, `OnEvent` timings and
  `Describe()` show what happened.

**Good for any app:**

- **Async-first.** Factories can be `async`. Concurrent resolves share one creation, and a failed
  creation is retried instead of cached.
- **Typed end to end.** Tokens carry their type, and `Deps` are checked against your
  constructor's parameters at compile time.
- **Scopes with levels.** One scope per request (or per tenant) with `await using`. Declare
  `Levels: ['tenant', 'request']` once; `Validate()` reports a longer-lived service that captures
  a shorter-lived one.
- **Errors you can act on.** Every error names the service, the resolution path and the fix, and
  has a stable code.

## Install

```sh
deno add jsr:@fathym/ioc
```

Node.js and Bun: `npx jsr add @fathym/ioc` (or `bunx jsr add @fathym/ioc`). Requires TypeScript 5.4+;
see [requirements](https://github.com/fathym/ioc/blob/main/docs/getting-started/installation.md#requirements).

## Quick start

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

// Exported, so other packages can use or replace it. A token you don't export stays private.
export const $Logger = IoCToken<Logger, 'Logger'>('Logger');

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

// The module owns these registrations. Default: true lets the app replace the logger.
const Data = DefineModule({
  Name: 'Data',
  Register: (ioc) =>
    ioc
      .RegisterClass(Config)
      .RegisterValue($Logger, { log: (m) => console.log(m) }, { Default: true })
      .RegisterClass(Repo, { Deps: [Config, $Logger] }), // checked against Repo's constructor
});

await using ioc = new IoCContainer().Typed().Use(Data);

await ioc.Start(); // validates the wiring, then builds every singleton

const repo = await ioc.Resolve(Repo); // typed as Repo

repo.logger.log(`Connected to ${repo.config.url}`);
```

## A quick tour

| You want to…                           | Use                                                 | Learn more                                                                                                  |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Register a class, factory or value     | `RegisterClass`, `RegisterFactory`, `RegisterValue` | [Registering services](https://github.com/fathym/ioc/blob/main/docs/guides/registering-services.md)         |
| Share a service, or keep it private    | export the `IoCToken`, or don't                     | [Keys and registrations](https://github.com/fathym/ioc/blob/main/docs/concepts/keys-and-registrations.md)   |
| Depend only on what's registered       | `Typed()` + chained registrations, `Deps`           | [Declared dependencies](https://github.com/fathym/ioc/blob/main/docs/guides/declared-dependencies.md)       |
| Package services as a unit             | `DefineModule`, `Use`, `Default: true`              | [Modules and lifecycle](https://github.com/fathym/ioc/blob/main/docs/guides/modules-and-lifecycle.md)       |
| Start and stop the app                 | `Start()`, `OnStart`/`OnStop`, `await using`        | [Modules and lifecycle](https://github.com/fathym/ioc/blob/main/docs/guides/modules-and-lifecycle.md)       |
| Start async services (DB, KV, clients) | async factories, `Start()` / `Activate()`           | [Async initialization](https://github.com/fathym/ioc/blob/main/docs/guides/async-initialization.md)         |
| One set of services per HTTP request   | `CreateScope()` + `await using`                     | [Per-request scopes](https://github.com/fathym/ioc/blob/main/docs/guides/per-request-scopes.md)             |
| Swap a dependency in a test            | `new IoCContainer({ Testing: true })`, `Override`   | [Testing](https://github.com/fathym/ioc/blob/main/docs/guides/testing.md)                                   |
| Wrap a service (logging, caching)      | `Decorate`                                          | [Decorating services](https://github.com/fathym/ioc/blob/main/docs/guides/decorating-services.md)           |
| Catch wiring mistakes at startup       | `Validate()`, `Start()`                             | [Organizing registrations](https://github.com/fathym/ioc/blob/main/docs/guides/organizing-registrations.md) |
| Understand an error                    | —                                                   | [Error catalog](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md)                           |

## Documentation

The full documentation lives in [`docs/`](https://github.com/fathym/ioc/blob/main/docs/README.md). Every code example in it is
type-checked and run in CI.

| Start here                                                                                                                                                        |                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [What is IoC, and when not to use it](https://github.com/fathym/ioc/blob/main/docs/what-is-ioc.md)                                                                | _[Explanation]_ The problem it solves, and its limits        |
| [Getting started](https://github.com/fathym/ioc/blob/main/docs/getting-started/README.md)                                                                         | _[Tutorial]_ Build a small API in five short steps           |
| [Concepts](https://github.com/fathym/ioc/blob/main/docs/concepts/README.md)                                                                                       | _[Explanation]_ Keys, lifetimes, scopes, async, disposal     |
| [Guides](https://github.com/fathym/ioc/blob/main/docs/guides/README.md)                                                                                           | _[How-to]_ Modules, testing, async startup, plugins          |
| [Patterns](https://github.com/fathym/ioc/blob/main/docs/patterns/README.md)                                                                                       | _[How-to]_ Plugin hosts, multi-tenant runtimes, CLIs, agents |
| [API reference](https://github.com/fathym/ioc/blob/main/docs/reference/api.md)                                                                                    | _[Reference]_ Every method and option                        |
| [Errors](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md) and [troubleshooting](https://github.com/fathym/ioc/blob/main/docs/troubleshooting.md) | _[Reference]_ Every error message, explained                 |
| [Upgrading from 0.x](https://github.com/fathym/ioc/blob/main/docs/migration/from-0.x.md)                                                                          | _[How-to]_ From 0.0.x and 0.1 to 1.0                         |
| [Coming from another container](https://github.com/fathym/ioc/blob/main/docs/migration/from-other-containers.md)                                                  | _[How-to]_ InversifyJS, tsyringe, awilix and more            |

The generated API docs are on [JSR](https://jsr.io/@fathym/ioc/doc). AI tools can start from
[`llms.txt`](https://github.com/fathym/ioc/blob/main/llms.txt).

## How it compares

Compared with InversifyJS, tsyringe, awilix, typed-inject, needle-di, NestJS and .NET's
container, this one trades breadth for a small, explicit API:

- **Async is first-class.** Most of the others resolve synchronously.
- **No decorators.** Several of the others depend on legacy decorator metadata.
- **Encapsulation uses the language.** A private service is one whose token isn't exported.
- **Scopes are explicit and cheap.**

See the [honest comparison](https://github.com/fathym/ioc/blob/main/docs/comparison.md), including when to choose something else.

## Status

Stable since 1.0, and used across the Fathym ecosystem (CLI, EaC runtime and libraries).

- Versions follow semantic versioning: breaking changes only in a major release, each with a
  migration guide. The [versioning policy](https://github.com/fathym/ioc/blob/main/docs/policy.md) covers deprecations, supported
  runtimes and how releases are made.
- Every change is listed in the [changelog](https://github.com/fathym/ioc/blob/main/CHANGELOG.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING](https://github.com/fathym/ioc/blob/main/CONTRIBUTING.md) for setup, tests and
documentation conventions. Please report security issues privately as described in
[SECURITY](https://github.com/fathym/ioc/blob/main/SECURITY.md). Everyone is expected to follow the
[Code of Conduct](https://github.com/fathym/ioc/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](https://github.com/fathym/ioc/blob/main/LICENSE) © Fathym
