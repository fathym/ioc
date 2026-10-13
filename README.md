---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc'
Summary: Small, async-first, decorator-free dependency injection for Deno, with typed tokens, scopes, disposal and startup validation.
Created: 2025-11-20
Updated: 2026-10-13
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

**Small, async-first, decorator-free dependency injection for Deno.**

[![JSR](https://jsr.io/badges/@fathym/ioc)](https://jsr.io/@fathym/ioc)
[![JSR Score](https://jsr.io/badges/@fathym/ioc/score)](https://jsr.io/@fathym/ioc/score)
[![Build](https://github.com/fathym/ioc/actions/workflows/build.yml/badge.svg)](https://github.com/fathym/ioc/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/fathym/ioc/blob/main/LICENSE)

Register your services once, resolve them anywhere, and let the container handle creation order,
async startup, per-request scopes and cleanup. No decorators, no `reflect-metadata`, no build
step.

## Why this container

- **Async-first.** Factories can be `async`. Concurrent resolves share one creation, and a
  failed creation is retried instead of cached, so a database that isn't up yet doesn't poison
  your app.
- **Nothing to configure.** Plain functions and classes. Works with Deno, esbuild, Vite and
  standard decorators, because it never needs decorator metadata.
- **Typed end to end.** Typed tokens, abstract classes as keys, and constructor dependencies that
  are checked against your constructor's parameters at compile time. On a typed container,
  dependencies must also be registered first, or the code doesn't compile.
- **Scopes and cleanup.** One scope per request with `await using`. Instances are disposed last
  created, first disposed.
- **Fails loudly, early.** Missing services name the resolution path, cycles throw instead of
  hanging on a single resolution, and `Validate()` / `Activate()` catch wiring mistakes at startup.

## Install

```sh
deno add jsr:@fathym/ioc
```

Node.js and Bun: `npx jsr add @fathym/ioc` (or `bunx jsr add @fathym/ioc`).

## Quick start

```ts
import { IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

const $Logger = IoCToken<Logger, 'Logger'>('Logger');

class Config {
  public url = Deno.env.get('DB_URL') ?? 'kv://local';
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

const ioc = new IoCContainer()
  .Typed() // from here on, Deps may only name what's registered above
  .RegisterClass(Config)
  .RegisterFactory($Logger, () => ({ log: (message) => console.log(message) }))
  .RegisterClass(Repo, { Deps: [Config, $Logger] }); // checked against Repo's constructor

ioc.Validate(); // throws, listing every missing dependency, cycle or captive dependency

const repo = await ioc.Resolve(Repo); // typed as Repo

repo.logger.log(`Connected to ${repo.config.url}`);
```

## A quick tour

| You want to…                           | Use                                                 | Learn more                                                                                                  |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Register a class, factory or value     | `RegisterClass`, `RegisterFactory`, `RegisterValue` | [Registering services](https://github.com/fathym/ioc/blob/main/docs/guides/registering-services.md)         |
| Depend only on what's registered       | `Typed()` + chained registrations, `Deps`           | [Declared dependencies](https://github.com/fathym/ioc/blob/main/docs/guides/declared-dependencies.md)       |
| Resolve without generics               | `IoCToken<T>('Name')`                               | [Keys and registrations](https://github.com/fathym/ioc/blob/main/docs/concepts/keys-and-registrations.md)   |
| Start async services (DB, KV, clients) | async factories, `Lazy: true`, `Activate()`         | [Async initialization](https://github.com/fathym/ioc/blob/main/docs/guides/async-initialization.md)         |
| One set of services per HTTP request   | `CreateScope()` + `await using`                     | [Per-request scopes](https://github.com/fathym/ioc/blob/main/docs/guides/per-request-scopes.md)             |
| Swap a dependency in a test            | register on a scope                                 | [Testing](https://github.com/fathym/ioc/blob/main/docs/guides/testing.md)                                   |
| Wrap a service (logging, caching)      | `Decorate`                                          | [Decorating services](https://github.com/fathym/ioc/blob/main/docs/guides/decorating-services.md)           |
| Catch wiring mistakes at startup       | `Validate()`, `Activate()`                          | [Organizing registrations](https://github.com/fathym/ioc/blob/main/docs/guides/organizing-registrations.md) |
| Understand an error                    | —                                                   | [Error catalog](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md)                           |

## Documentation

The full documentation lives in [`docs/`](https://github.com/fathym/ioc/blob/main/docs/README.md).
Every code example in it is type-checked in CI.

| Start here                                                                                                                                                        |                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [What is IoC, and when not to use it](https://github.com/fathym/ioc/blob/main/docs/what-is-ioc.md)                                                                | _[Explanation]_ The problem it solves, and its limits  |
| [Getting started](https://github.com/fathym/ioc/blob/main/docs/getting-started/README.md)                                                                         | _[Tutorial]_ Build a small API in five short steps     |
| [Concepts](https://github.com/fathym/ioc/blob/main/docs/concepts/README.md)                                                                                       | _[Explanation]_ Lifetimes, scopes, async, disposal     |
| [Guides](https://github.com/fathym/ioc/blob/main/docs/guides/README.md)                                                                                           | _[How-to]_ Testing, async startup, plugins, decorators |
| [API reference](https://github.com/fathym/ioc/blob/main/docs/reference/api.md)                                                                                    | _[Reference]_ Every method and option                  |
| [Errors](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md) and [troubleshooting](https://github.com/fathym/ioc/blob/main/docs/troubleshooting.md) | _[Reference]_ Every error message, explained           |
| [Upgrading from 0.0.x](https://github.com/fathym/ioc/blob/main/docs/migration/from-0.0.x.md)                                                                      | _[How-to]_ What changed and why                        |
| [Coming from another container](https://github.com/fathym/ioc/blob/main/docs/migration/from-other-containers.md)                                                  | _[How-to]_ InversifyJS, tsyringe, awilix and more      |

The generated API docs are on [JSR](https://jsr.io/@fathym/ioc/doc). AI tools can start from
[`llms.txt`](https://github.com/fathym/ioc/blob/main/llms.txt).

## How it compares

Compared with InversifyJS, tsyringe, awilix, typed-inject, needle-di, NestJS and .NET's
container, this one trades breadth for a small, explicit API:

- **Async is first-class.** Most of the others resolve synchronously.
- **No decorators.** Several of the others depend on legacy decorator metadata.
- **Scopes are explicit and cheap.**

See the [honest comparison](https://github.com/fathym/ioc/blob/main/docs/comparison.md), including
when to choose something else.

## Status

Pre-1.0 and used across the Fathym ecosystem (CLI, EaC runtime and libraries).

- The API is still settling: everything new since 0.0.36 is listed under _Unreleased_ in the
  changelog, and older call shapes keep working.
- Behavior changes come with migration notes in the [changelog](https://github.com/fathym/ioc/blob/main/CHANGELOG.md).
- Older versions of the container interoperate in the same process.

## Contributing

Contributions are welcome. See [CONTRIBUTING](https://github.com/fathym/ioc/blob/main/CONTRIBUTING.md)
for setup, tests and documentation conventions. Please report security issues privately as
described in [SECURITY](https://github.com/fathym/ioc/blob/main/SECURITY.md). Everyone is expected
to follow the [Code of Conduct](https://github.com/fathym/ioc/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](https://github.com/fathym/ioc/blob/main/LICENSE) © Fathym
