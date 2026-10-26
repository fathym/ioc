---
FrontmatterVersion: 1
DocumentType: Guide
Title: '@fathym/ioc'
Summary: Small, async-first, decorator-free dependency injection for Deno, Node.js and Bun - typed keys, explicit registration, scopes, modules and checked wiring.
Created: 2025-11-20
Updated: 2026-10-22
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

**Small, async-first, decorator-free dependency injection for Deno, Node.js and Bun.**

[![JSR](https://jsr.io/badges/@fathym/ioc)](https://jsr.io/@fathym/ioc)
[![JSR Score](https://jsr.io/badges/@fathym/ioc/score)](https://jsr.io/@fathym/ioc/score)
[![Build](https://github.com/fathym/ioc/actions/workflows/build.yml/badge.svg)](https://github.com/fathym/ioc/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/fathym/ioc/blob/main/LICENSE)

Register your services once, resolve them anywhere, and let the container handle creation order,
async setup, per-request scopes and cleanup. No decorators, no `reflect-metadata`, no build step.

## What you get

- **Typed keys.** `IoCToken<T, 'Name'>('Name')` is a typed name: `Symbol.for('Name')`
  underneath, so packages that use the same name share the key. A class is its own key, by
  reference.
- **Explicit registration.** `RegisterClass`, `RegisterFactory` and `RegisterValue`, with
  `Deps` checked against your constructor at compile time. Registering a key twice throws unless
  you say `Replace: true`; framework defaults use `Default: true` and yield to the app.
- **Async-first.** Factories can be `async`. Concurrent resolves share one build, a failed build
  is retried, and a cycle through a factory's `ioc` throws at once.
- **Scopes and cleanup.** One scope per request or command, with `await using`. Instances are
  disposed by the container that built them, in reverse order.
- **Modules.** Units of registrations with `OnStart`/`OnStop`. `Start()` runs them in order, a
  failed start stops what started, and `Dispose()` stops them in reverse. `DefineModule` types
  what a module needs and provides.
- **Checked wiring.** `Validate()` reports missing, cyclic and captive dependencies. Every error
  has a stable code and names the fix.

## Install

```sh
deno add jsr:@fathym/ioc
```

Node.js (20+) and Bun: `npx jsr add @fathym/ioc` (or `bunx jsr add @fathym/ioc`). Requires
TypeScript 5.4+; see
[requirements](https://github.com/fathym/ioc/blob/main/docs/getting-started/installation.md#requirements).

## Quick start

```ts
import { DefineModule, IoCContainer, IoCToken } from '@fathym/ioc';

interface Logger {
  log(message: string): void;
}

// A token is a typed name; any package that uses the same name gets the same key.
export const $Logger = IoCToken<Logger, 'app/Logger'>('app/Logger');

class Config {
  public url = 'kv://local';
}

class Repo {
  constructor(public config: Config, public logger: Logger) {}
}

// Default: true lets the app replace the logger.
const Data = DefineModule({
  Name: 'Data',
  Register: (ioc) =>
    ioc
      .RegisterClass(Config)
      .RegisterValue($Logger, { log: (m) => console.log(m) }, { Default: true })
      .RegisterClass(Repo, { Deps: [Config, $Logger] }), // checked against Repo's constructor
  OnStart: () => console.log('data ready'),
});

await using ioc = new IoCContainer().Typed().Use(Data);

await ioc.Start(); // validates the wiring, then runs OnStart: data ready

const repo = await ioc.Resolve(Repo); // typed as Repo

repo.logger.log(`Connected to ${repo.config.url}`);
```

## Documentation

The full documentation lives in [`docs/`](https://github.com/fathym/ioc/blob/main/docs/README.md).
Every code example in it is type-checked and run in CI.

| Page                                                                                      |                                                      |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Getting started](https://github.com/fathym/ioc/blob/main/docs/getting-started/README.md) | _[Tutorial]_ A small app in five short steps         |
| [API reference](https://github.com/fathym/ioc/blob/main/docs/reference/api.md)            | _[Reference]_ Every method and option                |
| [Errors](https://github.com/fathym/ioc/blob/main/docs/reference/errors.md)                | _[Reference]_ Every error message, and how to fix it |
| [Upgrading from 0.x](https://github.com/fathym/ioc/blob/main/docs/migration/from-0.x.md)  | _[How-to]_ Old call to new call                      |

The generated API docs are on [JSR](https://jsr.io/@fathym/ioc/doc). AI tools can start from
[`llms.txt`](https://github.com/fathym/ioc/blob/main/llms.txt).

## Status

Used across the Fathym ecosystem (CLI, EaC runtime and libraries).

- Versions follow semantic versioning: breaking changes only in a major release, each with a
  migration guide. The [versioning policy](https://github.com/fathym/ioc/blob/main/docs/policy.md)
  covers deprecations, supported runtimes and releases.
- Every change is listed in the [changelog](https://github.com/fathym/ioc/blob/main/CHANGELOG.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING](https://github.com/fathym/ioc/blob/main/CONTRIBUTING.md)
for setup, tests and documentation conventions. Please report security issues privately as
described in [SECURITY](https://github.com/fathym/ioc/blob/main/SECURITY.md). Everyone is expected
to follow the [Code of Conduct](https://github.com/fathym/ioc/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](https://github.com/fathym/ioc/blob/main/LICENSE) © Fathym
